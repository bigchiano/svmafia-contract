import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaContract } from "../target/types/solana_contract";
import { PublicKey, Keypair } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaContract as Program<SolanaContract>;
  
  // Get parameters from command line
  const gameId = process.argv[2] || "mafia-game-1";
  const targetPlayerPubkey = process.argv[3];
  const voterKeypairArg = process.argv[4];
  
  if (!targetPlayerPubkey) {
    console.error("❌ Please provide target player public key as second argument");
    console.log("Usage: ts-node scripts/cast-vote.ts <gameId> <targetPlayerPubkey> [voterKeypair]");
    return;
  }

  // Use provided keypair or default wallet
  const voterKeypair = voterKeypairArg 
    ? Keypair.fromSecretKey(Buffer.from(JSON.parse(voterKeypairArg)))
    : provider.wallet as anchor.Wallet;

  // Find PDA for the game
  const [gamePDA] = await PublicKey.findProgramAddress(
    [Buffer.from("game"), Buffer.from(gameId)],
    program.programId
  );

  console.log("Casting vote...");
  console.log("Game ID:", gameId);
  console.log("Voter:", voterKeypair.publicKey.toString());
  console.log("Target:", targetPlayerPubkey);
  console.log("Game PDA:", gamePDA.toString());

  try {
    // Check current game state
    const gameAccount = await program.account.game.fetch(gamePDA);
    console.log("\nCurrent Game State:");
    console.log("- State:", Object.keys(gameAccount.state)[0]);
    console.log("- Phase:", Object.keys(gameAccount.currentPhase)[0]);
    console.log("- Day Count:", gameAccount.dayCount);
    console.log("- Total Votes:", gameAccount.votes.length);

    // Check if voter is alive
    const voter = gameAccount.players.find(p => p.address.equals(voterKeypair.publicKey));
    if (!voter) {
      console.log("❌ Voter is not in the game!");
      return;
    }
    if (!voter.isAlive) {
      console.log("❌ Voter is dead and cannot vote!");
      return;
    }

    // Check if target is alive
    const target = gameAccount.players.find(p => p.address.toString() === targetPlayerPubkey);
    if (!target) {
      console.log("❌ Target player is not in the game!");
      return;
    }
    if (!target.isAlive) {
      console.log("❌ Target player is dead and cannot be voted for!");
      return;
    }

    await program.methods
      .castVote(new PublicKey(targetPlayerPubkey))
      .accounts({
        game: gamePDA,
        voter: voterKeypair.publicKey,
      })
      .signers([voterKeypair])
      .rpc();

    console.log("✅ Vote cast successfully!");
    
    // Fetch and display updated game state
    const updatedGameAccount = await program.account.game.fetch(gamePDA);
    console.log("\nUpdated Game State:");
    console.log("- Total Votes:", updatedGameAccount.votes.length);
    
    // Show current votes
    console.log("\nCurrent Votes:");
    updatedGameAccount.votes.forEach((vote, index) => {
      const voter = updatedGameAccount.players.find(p => p.address.equals(vote.voter));
      const target = updatedGameAccount.players.find(p => p.address.equals(vote.target));
      console.log(`- Vote ${index + 1}: ${voter?.address.toString().slice(0, 8)}... -> ${target?.address.toString().slice(0, 8)}...`);
    });
    
  } catch (error) {
    console.error("❌ Failed to cast vote:", error);
  }
}

main().catch(console.error); 