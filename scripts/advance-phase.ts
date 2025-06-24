import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaContract } from "../target/types/solana_contract";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaContract as Program<SolanaContract>;
  const authority = provider.wallet as anchor.Wallet;
  
  // Get game ID from command line or use default
  const gameId = process.argv[2] || "mafia-game-1";

  // Find PDA for the game
  const [gamePDA] = await PublicKey.findProgramAddress(
    [Buffer.from("game"), Buffer.from(gameId)],
    program.programId
  );

  console.log("Advancing game phase...");
  console.log("Game ID:", gameId);
  console.log("Authority:", authority.publicKey.toString());
  console.log("Game PDA:", gamePDA.toString());

  try {
    // Check current game state
    const gameAccount = await program.account.game.fetch(gamePDA);
    console.log("\nCurrent Game State:");
    console.log("- State:", Object.keys(gameAccount.state)[0]);
    console.log("- Phase:", Object.keys(gameAccount.currentPhase)[0]);
    console.log("- Day Count:", gameAccount.dayCount);
    console.log("- Total Votes:", gameAccount.votes.length);
    console.log("- Eliminated Players:", gameAccount.eliminatedPlayers.length);

    if (gameAccount.state.hasOwnProperty("waitingForPlayers")) {
      console.log("❌ Game hasn't started yet!");
      return;
    }

    if (gameAccount.state.hasOwnProperty("finished")) {
      console.log("❌ Game is already finished!");
      return;
    }

    await program.methods
      .advancePhase()
      .accounts({
        game: gamePDA,
        authority: authority.publicKey,
      })
      .rpc();

    console.log("✅ Phase advanced successfully!");
    
    // Fetch and display updated game state
    const updatedGameAccount = await program.account.game.fetch(gamePDA);
    console.log("\nUpdated Game State:");
    console.log("- State:", Object.keys(updatedGameAccount.state)[0]);
    console.log("- Phase:", Object.keys(updatedGameAccount.currentPhase)[0]);
    console.log("- Day Count:", updatedGameAccount.dayCount);
    console.log("- Total Votes:", updatedGameAccount.votes.length);
    console.log("- Eliminated Players:", updatedGameAccount.eliminatedPlayers.length);
    
    // Show eliminated players if any
    if (updatedGameAccount.eliminatedPlayers.length > 0) {
      console.log("\nEliminated Players:");
      updatedGameAccount.eliminatedPlayers.forEach((player, index) => {
        console.log(`- ${index + 1}: ${player.toString().slice(0, 8)}...`);
      });
    }
    
    // Check if game ended
    if (updatedGameAccount.state.hasOwnProperty("finished")) {
      console.log("\n🎉 Game has ended!");
      console.log("- Winner:", Object.keys(updatedGameAccount.winner)[0]);
    }
    
  } catch (error) {
    console.error("❌ Failed to advance phase:", error);
  }
}

main().catch(console.error); 