import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaContract } from "../target/types/solana_contract";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaContract as Program<SolanaContract>;
  
  // Get game ID from command line or use default
  const gameId = process.argv[2] || "mafia-game-1";

  // Find PDA for the game
  const [gamePDA] = await PublicKey.findProgramAddress(
    [Buffer.from("game"), Buffer.from(gameId)],
    program.programId
  );

  console.log("Viewing game state...");
  console.log("Game ID:", gameId);
  console.log("Game PDA:", gamePDA.toString());

  try {
    const gameAccount = await program.account.game.fetch(gamePDA);
    
    console.log("\n" + "=".repeat(50));
    console.log("🎮 MAFIA GAME STATE");
    console.log("=".repeat(50));
    
    // Basic game info
    console.log("\n📋 GAME INFO:");
    console.log("- Game ID:", gameAccount.gameId);
    console.log("- Creator:", gameAccount.creator.toString().slice(0, 8) + "...");
    console.log("- Max Players:", gameAccount.maxPlayers);
    console.log("- Entry Fee:", gameAccount.entryFee.toNumber() / LAMPORTS_PER_SOL, "SOL");
    console.log("- Created At:", new Date(gameAccount.createdAt * 1000).toLocaleString());
    
    // Game state
    console.log("\n🎯 GAME STATE:");
    console.log("- State:", Object.keys(gameAccount.state)[0]);
    console.log("- Phase:", Object.keys(gameAccount.currentPhase)[0]);
    console.log("- Day Count:", gameAccount.dayCount);
    console.log("- Phase Start Time:", new Date(gameAccount.phaseStartTime * 1000).toLocaleString());
    
    // Players
    console.log("\n👥 PLAYERS (" + gameAccount.players.length + "/" + gameAccount.maxPlayers + "):");
    gameAccount.players.forEach((player, index) => {
      const role = Object.keys(player.role)[0];
      const status = player.isAlive ? "🟢 ALIVE" : "🔴 DEAD";
      const voteTarget = player.voteTarget ? `(Voting: ${player.voteTarget.toString().slice(0, 8)}...)` : "";
      console.log(`  ${index + 1}. ${player.address.toString().slice(0, 8)}... | ${role.toUpperCase()} | ${status} ${voteTarget}`);
    });
    
    // Votes
    if (gameAccount.votes.length > 0) {
      console.log("\n🗳️  CURRENT VOTES:");
      gameAccount.votes.forEach((vote, index) => {
        const voter = gameAccount.players.find(p => p.address.equals(vote.voter));
        const target = gameAccount.players.find(p => p.address.equals(vote.target));
        console.log(`  ${index + 1}. ${voter?.address.toString().slice(0, 8)}... → ${target?.address.toString().slice(0, 8)}...`);
      });
    }
    
    // Eliminated players
    if (gameAccount.eliminatedPlayers.length > 0) {
      console.log("\n💀 ELIMINATED PLAYERS:");
      gameAccount.eliminatedPlayers.forEach((player, index) => {
        console.log(`  ${index + 1}. ${player.toString().slice(0, 8)}...`);
      });
    }
    
    // Winner
    if (gameAccount.winner) {
      console.log("\n🏆 WINNER:");
      console.log("- Winner:", Object.keys(gameAccount.winner)[0].toUpperCase());
    }
    
    // Game statistics
    const alivePlayers = gameAccount.players.filter(p => p.isAlive);
    const mafiaPlayers = gameAccount.players.filter(p => p.isAlive && p.role.hasOwnProperty("mafia"));
    const townPlayers = gameAccount.players.filter(p => p.isAlive && !p.role.hasOwnProperty("mafia"));
    
    console.log("\n📊 STATISTICS:");
    console.log("- Alive Players:", alivePlayers.length);
    console.log("- Mafia Players:", mafiaPlayers.length);
    console.log("- Town Players:", townPlayers.length);
    console.log("- Total Votes:", gameAccount.votes.length);
    
    // Game status summary
    console.log("\n🎮 GAME STATUS:");
    if (gameAccount.state.hasOwnProperty("waitingForPlayers")) {
      if (gameAccount.players.length >= 4) {
        console.log("✅ Ready to start! Use 'start-game.ts' to begin.");
      } else {
        console.log("⏳ Waiting for more players... Need at least 4.");
      }
    } else if (gameAccount.state.hasOwnProperty("active")) {
      if (gameAccount.currentPhase.hasOwnProperty("day")) {
        console.log("☀️  Day phase - Players can vote to eliminate someone.");
      } else {
        console.log("🌙 Night phase - Special roles can perform actions.");
      }
    } else if (gameAccount.state.hasOwnProperty("finished")) {
      console.log("🏁 Game finished! Winners can claim their winnings.");
    }
    
    console.log("\n" + "=".repeat(50));
    
  } catch (error) {
    console.error("❌ Failed to fetch game state:", error);
    console.log("The game might not exist or there might be a connection issue.");
  }
}

main().catch(console.error); 