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
  const actionType = process.argv[3]; // "mafiaKill", "detectiveInvestigate", "doctorHeal"
  const targetPlayerPubkey = process.argv[4]; // Optional for some actions
  const actorKeypairArg = process.argv[5];
  
  if (!actionType) {
    console.error("❌ Please provide action type as second argument");
    console.log("Usage: ts-node scripts/night-action.ts <gameId> <actionType> [targetPlayerPubkey] [actorKeypair]");
    console.log("Action types: mafiaKill, detectiveInvestigate, doctorHeal");
    return;
  }

  // Use provided keypair or default wallet
  const actorKeypair = actorKeypairArg 
    ? Keypair.fromSecretKey(Buffer.from(JSON.parse(actorKeypairArg)))
    : provider.wallet as anchor.Wallet;

  // Find PDA for the game
  const [gamePDA] = await PublicKey.findProgramAddress(
    [Buffer.from("game"), Buffer.from(gameId)],
    program.programId
  );

  console.log("Performing night action...");
  console.log("Game ID:", gameId);
  console.log("Actor:", actorKeypair.publicKey.toString());
  console.log("Action Type:", actionType);
  if (targetPlayerPubkey) {
    console.log("Target:", targetPlayerPubkey);
  }
  console.log("Game PDA:", gamePDA.toString());

  try {
    // Check current game state
    const gameAccount = await program.account.game.fetch(gamePDA);
    console.log("\nCurrent Game State:");
    console.log("- State:", Object.keys(gameAccount.state)[0]);
    console.log("- Phase:", Object.keys(gameAccount.currentPhase)[0]);
    console.log("- Day Count:", gameAccount.dayCount);

    if (!gameAccount.currentPhase.hasOwnProperty("night")) {
      console.log("❌ It's not night phase!");
      return;
    }

    // Check if actor is alive and in the game
    const actor = gameAccount.players.find(p => p.address.equals(actorKeypair.publicKey));
    if (!actor) {
      console.log("❌ Actor is not in the game!");
      return;
    }
    if (!actor.isAlive) {
      console.log("❌ Actor is dead and cannot perform actions!");
      return;
    }

    // Prepare action parameters
    let actionParams: any;
    let target: PublicKey | null = null;

    switch (actionType) {
      case "mafiaKill":
        if (!targetPlayerPubkey) {
          console.log("❌ Target player required for mafia kill!");
          return;
        }
        actionParams = { mafiaKill: {} };
        target = new PublicKey(targetPlayerPubkey);
        break;
      case "detectiveInvestigate":
        actionParams = { detectiveInvestigate: {} };
        break;
      case "doctorHeal":
        actionParams = { doctorHeal: {} };
        break;
      default:
        console.log("❌ Invalid action type!");
        return;
    }

    await program.methods
      .nightAction(actionParams, target)
      .accounts({
        game: gamePDA,
        actor: actorKeypair.publicKey,
      })
      .signers([actorKeypair])
      .rpc();

    console.log("✅ Night action performed successfully!");
    
    // Fetch and display updated game state
    const updatedGameAccount = await program.account.game.fetch(gamePDA);
    console.log("\nUpdated Game State:");
    console.log("- Eliminated Players:", updatedGameAccount.eliminatedPlayers.length);
    
    // Show eliminated players if any
    if (updatedGameAccount.eliminatedPlayers.length > 0) {
      console.log("\nEliminated Players:");
      updatedGameAccount.eliminatedPlayers.forEach((player, index) => {
        console.log(`- ${index + 1}: ${player.toString().slice(0, 8)}...`);
      });
    }
    
  } catch (error) {
    console.error("❌ Failed to perform night action:", error);
  }
}

main().catch(console.error); 