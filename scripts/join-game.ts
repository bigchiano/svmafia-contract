import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaContract } from "../target/types/solana_contract";
import { SystemProgram, PublicKey, Keypair } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaContract as Program<SolanaContract>;
  
  // Get game ID from command line or use default
  const gameId = process.argv[2] || "mafia-game-1";
  
  // Use provided keypair or generate new one for testing
  const playerKeypair = process.argv[3] 
    ? Keypair.fromSecretKey(Buffer.from(JSON.parse(process.argv[3])))
    : Keypair.generate();

  // Find PDA for the game
  const [gamePDA] = await PublicKey.findProgramAddress(
    [Buffer.from("game"), Buffer.from(gameId)],
    program.programId
  );

  console.log("Joining game...");
  console.log("Game ID:", gameId);
  console.log("Player:", playerKeypair.publicKey.toString());
  console.log("Game PDA:", gamePDA.toString());

  try {
    // Airdrop SOL to player if needed
    const balance = await provider.connection.getBalance(playerKeypair.publicKey);
    if (balance < 1000000) { // Less than 0.001 SOL
      console.log("Airdropping SOL to player...");
      await provider.connection.requestAirdrop(playerKeypair.publicKey, 1000000000); // 1 SOL
    }

    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: playerKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([playerKeypair])
      .rpc();

    console.log("✅ Successfully joined the game!");
    
    // Fetch and display updated game state
    const gameAccount = await program.account.game.fetch(gamePDA);
    console.log("\nUpdated Game State:");
    console.log("- Players:", gameAccount.players.length);
    console.log("- State:", Object.keys(gameAccount.state)[0]);
    
    // Show player info
    const player = gameAccount.players.find(p => p.address.equals(playerKeypair.publicKey));
    if (player) {
      console.log("- Your role:", Object.keys(player.role)[0]);
      console.log("- Alive:", player.isAlive);
    }
    
  } catch (error) {
    console.error("❌ Failed to join game:", error);
  }
}

main().catch(console.error); 