import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaContract } from "../target/types/solana_contract";
import { assert } from "chai";
import {
  Keypair,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

describe("solana-contract", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaContract as Program<SolanaContract>;
  const creator = provider.wallet as anchor.Wallet;

  const gameId = "mafia-game-1";
  const maxPlayers = 4;
  const entryFee = new anchor.BN(LAMPORTS_PER_SOL / 10); // 0.1 SOL

  let gamePDA: PublicKey;

  const players: { keypair: Keypair; role?: any; isAlive: boolean }[] = [];
  for (let i = 0; i < maxPlayers; i++) {
    players.push({ keypair: Keypair.generate(), isAlive: true });
  }

  const nonPlayer = Keypair.generate();

  before(async () => {
    [gamePDA] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), Buffer.from(gameId)],
      program.programId
    );

    const airdropPromises = [
      provider.connection.requestAirdrop(creator.publicKey, 5 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(nonPlayer.publicKey, 2 * LAMPORTS_PER_SOL),
      ...players.map(p => provider.connection.requestAirdrop(p.keypair.publicKey, 2 * LAMPORTS_PER_SOL))
    ];
    await Promise.all(airdropPromises);
  });

  it("Initializes a new game", async () => {
    await program.methods
      .initializeGame(gameId, maxPlayers, entryFee)
      .accounts({
        game: gamePDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const gameAccount = await program.account.game.fetch(gamePDA);
    assert.strictEqual(gameAccount.gameId, gameId, "Game ID should match");
    assert.isTrue(gameAccount.creator.equals(creator.publicKey), "Creator should match");
    assert.strictEqual(gameAccount.maxPlayers, maxPlayers, "Max players should match");
    assert.isTrue(gameAccount.entryFee.eq(entryFee), "Entry fee should match");
    assert.ok(gameAccount.state.hasOwnProperty("waitingForPlayers"), "Game should be waiting for players");
    assert.strictEqual(gameAccount.players.length, 0, "Game should have no players initially");
  });

  it("Fails to initialize a game with the same ID", async () => {
    try {
      await program.methods
        .initializeGame(gameId, maxPlayers, entryFee)
        .accounts({
          game: gamePDA,
          creator: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have failed to initialize the same game twice.");
    } catch (err) {
      assert.include(err.toString(), "Allocate: account Address { address: ", "Error should be due to account already in use");
    }
  });

  it("Allows players to join a game", async () => {
    for (let i = 0; i < 2; i++) {
      const player = players[i];
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player.keypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([player.keypair])
        .rpc();
    }
    const gameAccount = await program.account.game.fetch(gamePDA);
    assert.equal(gameAccount.players.length, 2);
  });

  it("Fails when a player tries to join twice", async () => {
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: players[0].keypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([players[0].keypair])
        .rpc();
      assert.fail("A player should not be able to join twice.");
    } catch (err) {
      assert.equal(err.error.errorCode.code, "AlreadyJoined");
    }
  });

  it("Allows more players to join, filling the game", async () => {
    for (let i = 2; i < maxPlayers; i++) {
      const player = players[i];
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player.keypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([player.keypair])
        .rpc();
    }
    const gameAccount = await program.account.game.fetch(gamePDA);
    assert.equal(gameAccount.players.length, maxPlayers);
  });

  it("Fails when the game is full", async () => {
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: nonPlayer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([nonPlayer])
        .rpc();
      assert.fail("Should not be able to join a full game.");
    } catch (err) {
      assert.equal(err.error.errorCode.code, "GameFull");
    }
  });

  it("Fails to start game by a non-creator", async () => {
    try {
      await program.methods
        .startGame()
        .accounts({
          game: gamePDA,
          creator: nonPlayer.publicKey,
        })
        .signers([nonPlayer])
        .rpc();
      assert.fail("Non-creator should not be able to start the game.");
    } catch (err) {
      assert.equal(err.error.errorCode.code, "NotCreator");
    }
  });

  it("Creator starts the game", async () => {
    await program.methods
      .startGame()
      .accounts({
        game: gamePDA,
        creator: creator.publicKey,
      })
      .rpc();

    const gameAccount = await program.account.game.fetch(gamePDA);
    assert.ok(gameAccount.state.hasOwnProperty("active"));
    assert.ok(gameAccount.currentPhase.hasOwnProperty("day"));
    assert.equal(gameAccount.dayCount, 1);

    const mafiaCount = Math.max(1, gameAccount.players.length / 4);
    let foundMafia = 0;
    gameAccount.players.forEach((p, i) => {
        players[i].role = p.role;
        if (p.role.hasOwnProperty("mafia")) {
            foundMafia++;
        }
    });
    assert.equal(foundMafia, mafiaCount);
  });
  
  it("Fails to join a game that has already started", async () => {
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: nonPlayer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([nonPlayer])
        .rpc();
      assert.fail("Should not be able to join a started game.");
    } catch (err) {
      assert.equal(err.error.errorCode.code, "GameNotJoinable");
    }
  });

  it("Allows an alive player to cast a vote during the day", async () => {
    const voter = players[1].keypair;
    const target = players[3].keypair;
    
    await program.methods
      .castVote(target.publicKey)
      .accounts({
        game: gamePDA,
        voter: voter.publicKey,
      })
      .signers([voter])
      .rpc();

    const gameAccount = await program.account.game.fetch(gamePDA);
    const vote = gameAccount.votes.find(v => v.voter.equals(voter.publicKey));
    assert.ok(vote);
    assert.isTrue(vote.target.equals(target.publicKey));
  });

  it("Advances phase from Day to Night, eliminating a player", async () => {
    await program.methods.castVote(players[3].keypair.publicKey).accounts({ game: gamePDA, voter: players[2].keypair.publicKey }).signers([players[2].keypair]).rpc();
    await program.methods.castVote(players[3].keypair.publicKey).accounts({ game: gamePDA, voter: players[0].keypair.publicKey }).signers([players[0].keypair]).rpc();

    await program.methods.advancePhase().accounts({ game: gamePDA, authority: creator.publicKey }).rpc();
    
    const gameAccount = await program.account.game.fetch(gamePDA);
    assert.ok(gameAccount.currentPhase.hasOwnProperty("night"));
    assert.equal(gameAccount.players[3].isAlive, false);
    players[3].isAlive = false;
    assert.isTrue(gameAccount.eliminatedPlayers[0].equals(players[3].keypair.publicKey));
    assert.equal(gameAccount.votes.length, 0);
  });

  it("Fails to cast vote during Night phase", async () => {
    try {
        const voter = players[1].keypair;
        const target = players[2].keypair;
        await program.methods.castVote(target.publicKey).accounts({ game: gamePDA, voter: voter.publicKey }).signers([voter]).rpc();
        assert.fail("Should not be able to vote at night");
    } catch(err) {
        assert.equal(err.error.errorCode.code, "NotVotingPhase");
    }
  });

  it("Fails for a dead player to cast a vote", async () => {
    await program.methods.advancePhase().accounts({ game: gamePDA, authority: creator.publicKey }).rpc(); // Night -> Day 2

    try {
        const voter = players[3].keypair; // Dead player
        const target = players[2].keypair;
        await program.methods.castVote(target.publicKey).accounts({ game: gamePDA, voter: voter.publicKey }).signers([voter]).rpc();
        assert.fail("Dead player should not be able to vote.");
    } catch(err) {
        assert.equal(err.error.errorCode.code, "PlayerDead");
    }
  });

  it("Allows Mafia to perform kill action at night", async () => {
    await program.methods.advancePhase().accounts({ game: gamePDA, authority: creator.publicKey }).rpc(); // Day 2 -> Night 2
    
    const mafia = players.find(p => p.role.hasOwnProperty('mafia'));
    const target = players.find(p => !p.role.hasOwnProperty('mafia') && p.isAlive);
    
    await program.methods.nightAction({ mafiaKill: {} }, target.keypair.publicKey)
        .accounts({ game: gamePDA, actor: mafia.keypair.publicKey})
        .signers([mafia.keypair])
        .rpc();

    const gameAccount = await program.account.game.fetch(gamePDA);
    const targetAccount = gameAccount.players.find(p => p.address.equals(target.keypair.publicKey));
    assert.isFalse(targetAccount.isAlive);
    target.isAlive = false;
  });

  it("Fails for non-mafia to perform kill action", async () => {
    const nonMafia = players.find(p => !p.role.hasOwnProperty('mafia') && p.isAlive);
    const target = players.find(p => p.isAlive && nonMafia && !p.keypair.publicKey.equals(nonMafia.keypair.publicKey));

    try {
       await program.methods.nightAction({ mafiaKill: {} }, target.keypair.publicKey)
        .accounts({ game: gamePDA, actor: nonMafia.keypair.publicKey})
        .signers([nonMafia.keypair])
        .rpc();
        assert.fail("Non-mafia player should not be able to perform kill action");
    } catch (err) {
        assert.equal(err.error.errorCode.code, "InvalidRole");
    }
  });

  it("Ends the game and allows a winner to claim winnings", async () => {
    // This test simulates a full game flow until a win condition is met.
    // It is a complex scenario and for a real-world test would be broken down further.
    // Let's assume the game has ended and Mafia has won.
    
    // Manually setting game state for test purposes, in a real test this would be the result of gameplay.
    let gameState = await program.account.game.fetch(gamePDA);
    
    while (!gameState.state.hasOwnProperty("finished")) {
        await program.methods.advancePhase().accounts({game: gamePDA, authority: creator.publicKey}).rpc();
        gameState = await program.account.game.fetch(gamePDA);
    }

    assert.ok(gameState.state.hasOwnProperty("finished"));
    assert.ok(gameState.winner.hasOwnProperty("mafia"));

    const winner = players.find(p => p.isAlive && p.role.hasOwnProperty('mafia'));
    const initialBalance = await provider.connection.getBalance(winner.keypair.publicKey);

    await program.methods.claimWinnings()
      .accounts({
        game: gamePDA,
        claimer: winner.keypair.publicKey,
      })
      .signers([winner.keypair])
      .rpc();

    const finalBalance = await provider.connection.getBalance(winner.keypair.publicKey);
    assert.isAbove(finalBalance, initialBalance);
  });

  it("Fails for a non-winner to claim winnings", async () => {
    const loser = players.find(p => !p.isAlive);
     try {
        await program.methods.claimWinnings()
        .accounts({
            game: gamePDA,
            claimer: loser.keypair.publicKey,
        })
        .signers([loser.keypair])
        .rpc();
        assert.fail("Non-winner should not be able to claim winnings");
     } catch (err) {
        assert.equal(err.error.errorCode.code, "NotWinner");
     }
  });
});
