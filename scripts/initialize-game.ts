import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaContract } from "../target/types/solana_contract";
import { SystemProgram, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaContract as Program<SolanaContract>;
  const creator = provider.wallet as anchor.Wallet;

  // Game parameters
  const gameId = "mafia-game-" + Date.now(); // Unique game ID
  const maxPlayers = 6;
  const entryFee = new anchor.BN(LAMPORTS_PER_SOL / 10); // 0.1 SOL

  // Find PDA for the game
  const [gamePDA] = await PublicKey.findProgramAddress(
    [Buffer.from("game"), Buffer.from(gameId)],
    program.programId
  );

  console.log("Initializing game...");
  console.log("Game ID:", gameId);
  console.log("Max Players:", maxPlayers);
  console.log("Entry Fee:", entryFee.toNumber() / LAMPORTS_PER_SOL, "SOL");
  console.log("Game PDA:", gamePDA.toString());

  try {
    await program.methods
      .initializeGame(gameId, maxPlayers, entryFee)
      .accounts({
        game: gamePDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Game initialized successfully!");
    
    // Fetch and display game state
    const gameAccount = await program.account.game.fetch(gamePDA);
    console.log("\nGame State:");
    console.log("- State:", Object.keys(gameAccount.state)[0]);
    console.log("- Players:", gameAccount.players.length);
    console.log("- Creator:", gameAccount.creator.toString());
    
  } catch (error) {
    console.error("❌ Failed to initialize game:", error);
  }
}

main().catch(console.error); 