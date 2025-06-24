import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaContract } from "../target/types/solana_contract";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaContract as Program<SolanaContract>;
  const creator = provider.wallet as anchor.Wallet;
  
  // Get game ID from command line or use default
  const gameId = process.argv[2] || "mafia-game-1";

  // Find PDA for the game
  const [gamePDA] = await PublicKey.findProgramAddress(
    [Buffer.from("game"), Buffer.from(gameId)],
    program.programId
  );

  console.log("Starting game...");
  console.log("Game ID:", gameId);
  console.log("Creator:", creator.publicKey.toString());
  console.log("Game PDA:", gamePDA.toString());

  try {
    // First, let's check the current game state
    const gameAccount = await program.account.game.fetch(gamePDA);
    console.log("\nCurrent Game State:");
    console.log("- State:", Object.keys(gameAccount.state)[0]);
    console.log("- Players:", gameAccount.players.length);
    console.log("- Max Players:", gameAccount.maxPlayers);

    if (gameAccount.players.length < 4) {
      console.log("❌ Need at least 4 players to start the game!");
      return;
    }

    await program.methods
      .startGame()
      .accounts({
        game: gamePDA,
        creator: creator.publicKey,
      })
      .rpc();

    console.log("✅ Game started successfully!");
    
    // Fetch and display updated game state
    const updatedGameAccount = await program.account.game.fetch(gamePDA);
    console.log("\nUpdated Game State:");
    console.log("- State:", Object.keys(updatedGameAccount.state)[0]);
    console.log("- Phase:", Object.keys(updatedGameAccount.currentPhase)[0]);
    console.log("- Day Count:", updatedGameAccount.dayCount);
    
    // Show player roles
    console.log("\nPlayer Roles:");
    updatedGameAccount.players.forEach((player, index) => {
      const role = Object.keys(player.role)[0];
      console.log(`- Player ${index + 1}: ${role} (${player.address.toString().slice(0, 8)}...)`);
    });
    
  } catch (error) {
    console.error("❌ Failed to start game:", error);
  }
}

main().catch(console.error); 