# Solana Mafia Game Scripts

This directory contains scripts to interact with the Solana Mafia Game smart contract. These scripts allow you to perform all the main functions of the game from the command line.

## Prerequisites

1. Make sure you have the Solana CLI installed and configured
2. Ensure you have a local validator running (`solana-test-validator`)
3. Set your Anchor provider to localhost
4. Build the project (`anchor build`)

## Scripts Overview

### 1. `initialize-game.ts` - Create a new game
Creates a new Mafia game with specified parameters.

```bash
ts-node scripts/initialize-game.ts
```

**Parameters:**
- Automatically generates a unique game ID with timestamp
- Sets max players to 6
- Sets entry fee to 0.1 SOL

### 2. `join-game.ts` - Join an existing game
Allows a player to join a game by paying the entry fee.

```bash
# Join with default game ID
ts-node scripts/join-game.ts

# Join specific game
ts-node scripts/join-game.ts <gameId>

# Join with specific keypair (for testing)
ts-node scripts/join-game.ts <gameId> <keypairJson>
```

### 3. `start-game.ts` - Start the game
Starts the game once enough players have joined (minimum 4).

```bash
# Start with default game ID
ts-node scripts/start-game.ts

# Start specific game
ts-node scripts/start-game.ts <gameId>
```

### 4. `cast-vote.ts` - Cast a vote during day phase
Allows alive players to vote for elimination during the day phase.

```bash
# Cast vote with default wallet
ts-node scripts/cast-vote.ts <gameId> <targetPlayerPubkey>

# Cast vote with specific keypair
ts-node scripts/cast-vote.ts <gameId> <targetPlayerPubkey> <voterKeypairJson>
```

### 5. `advance-phase.ts` - Advance game phase
Advances the game from day to night or night to day, processing votes and actions.

```bash
# Advance phase with default game ID
ts-node scripts/advance-phase.ts

# Advance specific game
ts-node scripts/advance-phase.ts <gameId>
```

### 6. `night-action.ts` - Perform night actions
Allows special roles to perform night actions (mafia kills, detective investigations, doctor heals).

```bash
# Mafia kill
ts-node scripts/night-action.ts <gameId> mafiaKill <targetPlayerPubkey>

# Detective investigate
ts-node scripts/night-action.ts <gameId> detectiveInvestigate

# Doctor heal
ts-node scripts/night-action.ts <gameId> doctorHeal

# With specific actor keypair
ts-node scripts/night-action.ts <gameId> <actionType> [targetPlayerPubkey] <actorKeypairJson>
```

### 7. `claim-winnings.ts` - Claim winnings
Allows winners to claim their share of the prize pool after the game ends.

```bash
# Claim with default wallet
ts-node scripts/claim-winnings.ts <gameId>

# Claim with specific keypair
ts-node scripts/claim-winnings.ts <gameId> <claimerKeypairJson>
```

### 8. `view-game.ts` - View game state
Displays the current state of a game without making any changes.

```bash
# View default game
ts-node scripts/view-game.ts

# View specific game
ts-node scripts/view-game.ts <gameId>
```

## Game Flow Example

Here's a typical game flow using these scripts:

1. **Create a game:**
   ```bash
   ts-node scripts/initialize-game.ts
   ```

2. **Join the game (run multiple times for different players):**
   ```bash
   ts-node scripts/join-game.ts mafia-game-1234567890
   ```

3. **Start the game:**
   ```bash
   ts-node scripts/start-game.ts mafia-game-1234567890
   ```

4. **Cast votes during day:**
   ```bash
   ts-node scripts/cast-vote.ts mafia-game-1234567890 <targetPlayerPubkey>
   ```

5. **Advance to night:**
   ```bash
   ts-node scripts/advance-phase.ts mafia-game-1234567890
   ```

6. **Perform night actions:**
   ```bash
   ts-node scripts/night-action.ts mafia-game-1234567890 mafiaKill <targetPlayerPubkey>
   ```

7. **Advance to next day:**
   ```bash
   ts-node scripts/advance-phase.ts mafia-game-1234567890
   ```

8. **Repeat voting and night actions until game ends**

9. **Claim winnings:**
   ```bash
   ts-node scripts/claim-winnings.ts mafia-game-1234567890
   ```

## Keypair Management

For testing with multiple players, you can generate keypairs and pass them as JSON:

```bash
# Generate a new keypair
solana-keygen new --outfile player1.json

# Use the keypair in scripts
ts-node scripts/join-game.ts <gameId> "$(cat player1.json)"
```

## Viewing Game State

Use the `view-game.ts` script to check the current state at any time:

```bash
ts-node scripts/view-game.ts <gameId>
```

This will show:
- Game information (ID, creator, entry fee)
- Current state and phase
- All players with their roles and status
- Current votes
- Eliminated players
- Winner (if game is finished)
- Game statistics

## Error Handling

All scripts include error handling and will display helpful error messages if:
- The game doesn't exist
- The player is not in the game
- The player is dead
- It's not the correct phase
- The player doesn't have the right role for an action
- The game hasn't started or is already finished

## Notes

- All scripts use the default Anchor provider (usually localhost)
- Scripts automatically handle SOL airdrops for testing
- Public keys are truncated in output for readability
- Timestamps are converted to local time for display
- The scripts include comprehensive state checking before performing actions 