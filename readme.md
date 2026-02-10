# SVM Mafia Contract

Solana program for an on-chain multiplayer game with real-time interactions and transparent game state. Built with Anchor.

## What it does

Players join game sessions where actions and outcomes are recorded on-chain for full transparency. The contract handles player registration, game state management, turn logic, and SOL transfers between participants — no off-chain server decides who wins.

Think of it as a social deduction game where the blockchain is the referee.

## Stack

- **Rust** — Solana program logic (Anchor framework)
- **TypeScript** — tests, migration scripts, and client interactions
- **Anchor** — program scaffolding, IDL generation, deployment

## Project structure

```
├── programs/solana-contract/   # Rust program source
├── tests/                      # TypeScript integration tests
├── scripts/                    # Utility scripts
├── migrations/                 # Anchor migration files
├── Anchor.toml                 # Anchor config (cluster, program ID, wallet)
├── Cargo.toml
└── package.json
```

## Setup

Prerequisites: [Rust](https://rustup.rs/), [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools), [Anchor](https://www.anchor-lang.com/docs/installation)

```bash
git clone https://github.com/bigchiano/svmafia-contract.git
cd svmafia-contract
yarn install
```

### Build

```bash
anchor build
```

### Test

```bash
anchor test
```

### Deploy (devnet)

```bash
anchor deploy --provider.cluster devnet
```

### Upgrade

```bash
anchor upgrade target/deploy/solana_contract.so --provider.cluster devnet --program-id <PROGRAM_ID>
```

## Why this is interesting

Most game backends run on centralized servers where the operator can manipulate outcomes. This moves the core game logic on-chain — every action is a signed transaction, every state change is verifiable, and fund transfers between players happen atomically within the program. No trust required.

This was also a good exercise in working within Solana's constraints: account size limits, compute budgets, and designing PDAs for game state that multiple players need to read and write to concurrently.
