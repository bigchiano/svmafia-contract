import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaContract } from "../target/types/solana_contract";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaContract as Program<SolanaContract>;
  
  // Get parameters from command line
  const gameId = process.argv[2] || "mafia-game-1";
  const claimerKeypairArg = process.argv[3];
  
  // Use provided keypair or default wallet
  const claimerKeypair = claimerKeypairArg 
    ? Keypair.fromSecretKey(Buffer.from(JSON.parse(claimerKeypairArg)))
    : provider.wallet as anchor.Wallet;

  // Find PDA for the game
  const [gamePDA] = await PublicKey.findProgramAddress(
    [Buffer.from("game"), Buffer.from(gameId)],
    program.programId
  );

  console.log("Claiming winnings...");
  console.log("Game ID:", gameId);
  console.log("Claimer:", claimerKeypair.publicKey.toString());
  console.log("Game PDA:", gamePDA.toString());

  try {
    // Check current game state
    const gameAccount = await program.account.game.fetch(gamePDA);
    console.log("\nCurrent Game State:");
    console.log("- State:", Object.keys(gameAccount.state)[0]);
    console.log("- Winner:", gameAccount.winner ? Object.keys(gameAccount.winner)[0] : "None");
    console.log("- Total Players:", gameAccount.players.length);
    console.log("- Entry Fee:", gameAccount.entryFee.toNumber() / LAMPORTS_PER_SOL, "SOL");

    if (!gameAccount.state.hasOwnProperty("finished")) {
      console.log("❌ Game is not finished yet!");
      return;
    }

    if (!gameAccount.winner) {
      console.log("❌ No winner determined!");
      return;
    }

    // Check if claimer is a winner
    const claimer = gameAccount.players.find(p => p.address.equals(claimerKeypair.publicKey));
    if (!claimer) {
      console.log("❌ Claimer is not in the game!");
      return;
    }

    const winner = Object.keys(gameAccount.winner)[0];
    const claimerRole = Object.keys(claimer.role)[0];
    
    let isWinner = false;
    if (winner === "mafia" && claimerRole === "mafia") {
      isWinner = true;
    } else if (winner === "town" && claimerRole !== "mafia") {
      isWinner = true;
    }

    if (!isWinner) {
      console.log("❌ Claimer is not a winner!");
      console.log("- Game Winner:", winner);
      console.log("- Claimer Role:", claimerRole);
      return;
    }

    // Get initial balance
    const initialBalance = await provider.connection.getBalance(claimerKeypair.publicKey);
    console.log("- Initial Balance:", initialBalance / LAMPORTS_PER_SOL, "SOL");

    await program.methods
      .claimWinnings()
      .accounts({
        game: gamePDA,
        claimer: claimerKeypair.publicKey,
      })
      .signers([claimerKeypair])
      .rpc();

    console.log("✅ Winnings claimed successfully!");
    
    // Get final balance
    const finalBalance = await provider.connection.getBalance(claimerKeypair.publicKey);
    const winnings = finalBalance - initialBalance;
    
    console.log("\nWinnings Summary:");
    console.log("- Final Balance:", finalBalance / LAMPORTS_PER_SOL, "SOL");
    console.log("- Winnings:", winnings / LAMPORTS_PER_SOL, "SOL");
    console.log("- Winner Type:", winner);
    console.log("- Claimer Role:", claimerRole);
    
  } catch (error) {
    console.error("❌ Failed to claim winnings:", error);
  }
}

main().catch(console.error); 