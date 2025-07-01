use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;
use std::collections::HashMap;

declare_id!("C2CdtqX8Xb3Jask61G8g3xFzn6bmXcQ623YmcCeyFUPk");

#[program]
pub mod solana_contract {
    use super::*;

    pub fn initialize_counter(ctx: Context<InitializeCounter>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        Ok(())
    }

    pub fn initialize_game(
        ctx: Context<InitializeGame>,
        name: String,
        max_players: u8,
        entry_fee: u64,
    ) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        let game = &mut ctx.accounts.game;
        let clock = Clock::get()?;
        
        // Increment counter and generate game_id
        counter.count += 1;
        let game_id = format!("game-{}", counter.count);
        game.game_id = game_id.clone();
        game.creator = ctx.accounts.creator.key();
        game.max_players = max_players;
        game.name = name.clone();
        game.entry_fee = entry_fee;
        game.state = GameState::WaitingForPlayers;
        game.created_at = clock.unix_timestamp;
        game.phase_start_time = clock.unix_timestamp;
        game.players = Vec::new();
        game.roles = Vec::new();
        game.votes = Vec::new();
        game.eliminated_players = Vec::new();
        game.current_phase = GamePhase::Lobby;
        game.day_count = 0;
        game.winner = None;
        
        emit!(GameCreated {
            game_id: game.game_id.clone(),
            creator: game.creator,
            max_players,
            name,
            entry_fee,
        });
        
        Ok(())
    }

    pub fn join_game(ctx: Context<JoinGame>) -> Result<()> {
        let player = ctx.accounts.player.key();
        let game_key = ctx.accounts.game.key();
        let game_account_info = ctx.accounts.game.to_account_info();
        let game = &mut ctx.accounts.game;
        
        require!(game.state == GameState::WaitingForPlayers, ErrorCode::GameNotJoinable);
        require!(game.players.len() <= game.max_players as usize, ErrorCode::GameFull);
        require!(!game.players.iter().any(|p| p.address == player), ErrorCode::AlreadyJoined);
        
        // Transfer entry fee
        if game.entry_fee > 0 {
            let ix = anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.player.key(),
                &game_key,
                game.entry_fee,
            );
            anchor_lang::solana_program::program::invoke(
                &ix,
                &[
                    ctx.accounts.player.to_account_info(),
                    game_account_info.clone(),
                ],
            )?;
        }
        
        game.players.push(Player {
            address: player,
            is_alive: true,
            role: Role::Unknown,
            vote_target: None,
            joined_at: Clock::get()?.unix_timestamp,
        });
        
        emit!(PlayerJoined {
            game_id: game.game_id.clone(),
            player: player,
            player_count: game.players.len() as u8,
        });
        
        Ok(())
    }

    pub fn start_game(ctx: Context<StartGame>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let clock = Clock::get()?;
        
        require!(game.creator == ctx.accounts.creator.key(), ErrorCode::NotCreator);
        require!(game.state == GameState::WaitingForPlayers, ErrorCode::GameNotStartable);
        require!(game.players.len() >= 4, ErrorCode::NotEnoughPlayers);
        
        // Assign roles randomly (simplified for demo)
        let mafia_count = std::cmp::max(1, game.players.len() / 4);
        
        for (i, player) in game.players.iter_mut().enumerate() {
            if i < mafia_count {
                player.role = Role::Mafia;
            } else if i == mafia_count {
                player.role = Role::Detective;
            } else if i == mafia_count + 1 {
                player.role = Role::Doctor;
            } else {
                player.role = Role::Civilian;
            }
        }
        
        game.state = GameState::Active;
        game.current_phase = GamePhase::Day;
        game.phase_start_time = clock.unix_timestamp;
        game.day_count = 1;
        
        emit!(GameStarted {
            game_id: game.game_id.clone(),
            player_count: game.players.len() as u8,
            day_count: game.day_count,
        });
        
        Ok(())
    }

    pub fn cast_vote(ctx: Context<CastVote>, target_player: Pubkey) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let voter = ctx.accounts.voter.key();
        
        require!(game.state == GameState::Active, ErrorCode::GameNotActive);
        require!(game.current_phase == GamePhase::Day, ErrorCode::NotVotingPhase);
        
        let voter_index = game.players.iter().position(|p| p.address == voter)
            .ok_or(ErrorCode::PlayerNotInGame)?;
        let target_index = game.players.iter().position(|p| p.address == target_player)
            .ok_or(ErrorCode::InvalidTarget)?;
        
        require!(game.players[voter_index].is_alive, ErrorCode::PlayerDead);
        require!(game.players[target_index].is_alive, ErrorCode::InvalidTarget);
        
        // Remove previous vote if exists
        game.votes.retain(|v| v.voter != voter);
        
        // Add new vote
        game.votes.push(Vote {
            voter,
            target: target_player,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        game.players[voter_index].vote_target = Some(target_player);
        
        emit!(VoteCast {
            game_id: game.game_id.clone(),
            voter,
            target: target_player,
            total_votes: game.votes.len() as u8,
        });
        
        Ok(())
    }

    pub fn advance_phase(ctx: Context<AdvancePhase>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let clock = Clock::get()?;
        
        require!(game.state == GameState::Active, ErrorCode::GameNotActive);
        
        match game.current_phase {
            GamePhase::Day => {
                // Process day votes and eliminate player
                let elimination_result = process_day_votes(game)?;
                if let Some(eliminated) = elimination_result {
                    emit!(PlayerEliminated {
                        game_id: game.game_id.clone(),
                        player: eliminated,
                        phase: game.current_phase,
                        day_count: game.day_count,
                    });
                }
                
                game.current_phase = GamePhase::Night;
            },
            GamePhase::Night => {
                // Process night actions (simplified)
                game.current_phase = GamePhase::Day;
                game.day_count += 1;
            },
            _ => return Err(ErrorCode::InvalidPhase.into()),
        }
        
        game.phase_start_time = clock.unix_timestamp;
        game.votes.clear();
        
        // Clear vote targets
        for player in &mut game.players {
            player.vote_target = None;
        }
        
        // Check win conditions
        let win_result = check_win_condition(game)?;
        if let Some(winner) = win_result {
            game.state = GameState::Finished;
            game.winner = Some(winner.clone());
            
            emit!(GameEnded {
                game_id: game.game_id.clone(),
                winner,
                day_count: game.day_count,
            });
        }
        
        emit!(PhaseChanged {
            game_id: game.game_id.clone(),
            new_phase: game.current_phase,
            day_count: game.day_count,
        });
        
        Ok(())
    }

    pub fn night_action(
        ctx: Context<NightAction>, 
        action_type: NightActionType,
        target: Option<Pubkey>
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let actor = ctx.accounts.actor.key();
        
        require!(game.state == GameState::Active, ErrorCode::GameNotActive);
        require!(game.current_phase == GamePhase::Night, ErrorCode::NotNightPhase);
        
        let actor_index = game.players.iter().position(|p| p.address == actor)
            .ok_or(ErrorCode::PlayerNotInGame)?;
        
        require!(game.players[actor_index].is_alive, ErrorCode::PlayerDead);
        
        match action_type {
            NightActionType::MafiaKill => {
                require!(game.players[actor_index].role == Role::Mafia, ErrorCode::InvalidRole);
                if let Some(target_addr) = target {
                    let target_index = game.players.iter().position(|p| p.address == target_addr)
                        .ok_or(ErrorCode::InvalidTarget)?;
                    require!(game.players[target_index].is_alive, ErrorCode::InvalidTarget);
                    
                    // Mark for elimination (simplified)
                    game.players[target_index].is_alive = false;
                    game.eliminated_players.push(target_addr);
                }
            },
            NightActionType::DetectiveInvestigate => {
                require!(game.players[actor_index].role == Role::Detective, ErrorCode::InvalidRole);
                // Investigation logic would be handled off-chain for privacy
            },
            NightActionType::DoctorHeal => {
                require!(game.players[actor_index].role == Role::Doctor, ErrorCode::InvalidRole);
                // Healing logic would prevent mafia kill
            },
        }
        
        emit!(NightActionPerformed {
            game_id: game.game_id.clone(),
            actor,
            action_type,
            target,
        });
        
        Ok(())
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let claimer = ctx.accounts.claimer.key();
        
        // Store values before mutable borrow
        let game_key = ctx.accounts.game.key();
        
        let game = &mut ctx.accounts.game;
        let game_id = game.game_id.clone();
        
        require!(game.state == GameState::Finished, ErrorCode::GameNotFinished);
        require!(game.winner.is_some(), ErrorCode::NoWinner);
        
        // Check if claimer is a winner
        let winner = game.winner.as_ref().unwrap();
        let is_winner = match winner {
            Winner::Mafia => game.players.iter().any(|p| p.address == claimer && p.role == Role::Mafia && p.is_alive),
            Winner::Town => game.players.iter().any(|p| p.address == claimer && p.role != Role::Mafia && p.is_alive),
        };
        
        require!(is_winner, ErrorCode::NotWinner);
        
        // Calculate winnings (simplified - equal split among winners)
        let winner_count = game.players.iter().filter(|p| {
            p.is_alive && match winner {
                Winner::Mafia => p.role == Role::Mafia,
                Winner::Town => p.role != Role::Mafia,
            }
        }).count();
        
        let winnings = game.entry_fee * game.players.len() as u64 / winner_count as u64;
        
        // Transfer winnings
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &game_key,
            &claimer,
            winnings,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.game.to_account_info(),
                ctx.accounts.claimer.to_account_info(),
            ],
        )?;
        
        emit!(WinningsClaimed {
            game_id,
            claimer,
            amount: winnings,
        });
        
        Ok(())
    }

    pub fn update_game_details(
        ctx: Context<UpdateGameDetails>,
        players: Vec<Player>,
        mafia_members: Vec<Pubkey>,
        votes: Vec<Vote>,
        winning_team: Option<Winner>,
        phase_start_time: i64,
        phase_end_time: i64,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;
        
        require!(players.len() <= 20, ErrorCode::TooManyPlayers);
        require!(game.creator == ctx.accounts.authority.key(), ErrorCode::NotCreator);
        
        // Clone values for the event
        let game_id = game.game_id.clone();
        let player_count = players.len() as u8;
        let mafia_count = mafia_members.len() as u8;
        let vote_count = votes.len() as u8;
        let winner_clone = winning_team.clone();
        
        // Update game details
        game.players = players;
        game.votes = votes;
        game.phase_start_time = phase_start_time;
        game.phase_end_time = phase_end_time;
        
        // Update mafia members
        for player in &mut game.players {
            if mafia_members.contains(&player.address) {
                player.role = Role::Mafia;
            }
        }
        
        // Update winner if provided
        if let Some(winner) = winning_team {
            game.winner = Some(winner);
            game.state = GameState::Finished;
        }
        
        emit!(GameUpdated {
            game_id,
            player_count,
            mafia_count,
            vote_count,
            winner: winner_clone,
        });
        
        Ok(())
    }
}

// Helper functions
fn process_day_votes(game: &mut Game) -> Result<Option<Pubkey>> {
    let mut vote_counts: HashMap<Pubkey, u32> = HashMap::new();
    
    for vote in &game.votes {
        *vote_counts.entry(vote.target).or_insert(0) += 1;
    }
    
    if let Some((most_voted, _)) = vote_counts.iter().max_by_key(|(_, count)| *count) {
        let target_index = game.players.iter().position(|p| p.address == *most_voted).unwrap();
        game.players[target_index].is_alive = false;
        game.eliminated_players.push(*most_voted);
        return Ok(Some(*most_voted));
    }
    
    Ok(None)
}

fn check_win_condition(game: &Game) -> Result<Option<Winner>> {
    let alive_mafia = game.players.iter().filter(|p| p.is_alive && p.role == Role::Mafia).count();
    let alive_town = game.players.iter().filter(|p| p.is_alive && p.role != Role::Mafia).count();
    
    if alive_mafia == 0 {
        return Ok(Some(Winner::Town));
    }
    
    if alive_mafia >= alive_town {
        return Ok(Some(Winner::Mafia));
    }
    
    Ok(None)
}

// Account structures
#[derive(Accounts)]
pub struct InitializeGame<'info> {
    #[account(
        mut,
        seeds = [b"game_counter"],
        bump
    )]
    pub counter: Account<'info, GameCounter>,
    #[account(
        init,
        payer = creator,
        space = 8 + Game::SPACE,
        seeds = [b"game", format!("game-{}", counter.count + 1).as_bytes()],
        bump
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartGame<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    pub voter: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdvancePhase<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct NightAction<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    pub actor: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub claimer: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeCounter<'info> {
    #[account(
        init,
        payer = payer,
        space = GameCounter::SPACE,
        seeds = [b"game_counter"],
        bump
    )]
    pub counter: Account<'info, GameCounter>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateGameDetails<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    pub authority: Signer<'info>,
}

#[account]
pub struct GameCounter {
    pub count: u64,
}

impl GameCounter {
    pub const SPACE: usize = 8 + 8; // discriminator + u64
}

// Data structures
#[account]
pub struct Game {
    pub game_id: String,
    pub name: String,
    pub creator: Pubkey,
    pub max_players: u8,
    pub entry_fee: u64,
    pub state: GameState,
    pub current_phase: GamePhase,
    pub day_count: u16,
    pub created_at: i64,
    pub phase_start_time: i64,
    pub phase_end_time: i64,
    pub players: Vec<Player>,
    pub roles: Vec<Role>,
    pub votes: Vec<Vote>,
    pub eliminated_players: Vec<Pubkey>,
    pub winner: Option<Winner>,
}

impl Game {
    pub const SPACE: usize = 32 + 32 + 1 + 8 + 1 + 1 + 2 + 8 + 8 + 8 + 
                             4 + (20 * (32 + 1 + 1 + 33 + 8)) + // players: Vec<Player> (max 20)
                             4 + (20 * 1) + // roles: Vec<Role> (max 20)
                             4 + (20 * (32 + 32 + 8)) + // votes: Vec<Vote> (max 20)
                             4 + (20 * 32) + // eliminated_players: Vec<Pubkey> (max 20)
                             2; // winner: Option<Winner>
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub struct Player {
    pub address: Pubkey,
    pub is_alive: bool,
    pub role: Role,
    pub vote_target: Option<Pubkey>,
    pub joined_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Vote {
    pub voter: Pubkey,
    pub target: Pubkey,
    pub timestamp: i64,
}

// Enums
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum GameState {
    WaitingForPlayers,
    Active,
    Finished,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq)]
pub enum GamePhase {
    Lobby,
    Day,
    Night,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum Role {
    Unknown,
    Mafia,
    Detective,
    Doctor,
    Civilian,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum Winner {
    Mafia,
    Town,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum NightActionType {
    MafiaKill,
    DetectiveInvestigate,
    DoctorHeal,
}

// Events
#[event]
pub struct GameCreated {
    pub game_id: String,
    pub name: String,
    pub creator: Pubkey,
    pub max_players: u8,
    pub entry_fee: u64,
}

#[event]
pub struct PlayerJoined {
    pub game_id: String,
    pub player: Pubkey,
    pub player_count: u8,
}

#[event]
pub struct GameStarted {
    pub game_id: String,
    pub player_count: u8,
    pub day_count: u16,
}

#[event]
pub struct VoteCast {
    pub game_id: String,
    pub voter: Pubkey,
    pub target: Pubkey,
    pub total_votes: u8,
}

#[event]
pub struct PhaseChanged {
    pub game_id: String,
    pub new_phase: GamePhase,
    pub day_count: u16,
}

#[event]
pub struct PlayerEliminated {
    pub game_id: String,
    pub player: Pubkey,
    pub phase: GamePhase,
    pub day_count: u16,
}

#[event]
pub struct GameEnded {
    pub game_id: String,
    pub winner: Winner,
    pub day_count: u16,
}

#[event]
pub struct NightActionPerformed {
    pub game_id: String,
    pub actor: Pubkey,
    pub action_type: NightActionType,
    pub target: Option<Pubkey>,
}

#[event]
pub struct WinningsClaimed {
    pub game_id: String,
    pub claimer: Pubkey,
    pub amount: u64,
}

#[event]
pub struct GameUpdated {
    pub game_id: String,
    pub player_count: u8,
    pub mafia_count: u8,
    pub vote_count: u8,
    pub winner: Option<Winner>,
}

// Error codes
#[error_code]
pub enum ErrorCode {
    #[msg("Game is not joinable")]
    GameNotJoinable,
    #[msg("Game is full")]
    GameFull,
    #[msg("Player already joined")]
    AlreadyJoined,
    #[msg("Not the game creator")]
    NotCreator,
    #[msg("Game is not startable")]
    GameNotStartable,
    #[msg("Not enough players")]
    NotEnoughPlayers,
    #[msg("Game is not active")]
    GameNotActive,
    #[msg("Not voting phase")]
    NotVotingPhase,
    #[msg("Player not in game")]
    PlayerNotInGame,
    #[msg("Invalid target")]
    InvalidTarget,
    #[msg("Player is dead")]
    PlayerDead,
    #[msg("Invalid phase")]
    InvalidPhase,
    #[msg("Not night phase")]
    NotNightPhase,
    #[msg("Invalid role")]
    InvalidRole,
    #[msg("Game not finished")]
    GameNotFinished,
    #[msg("No winner")]
    NoWinner,
    #[msg("Not a winner")]
    NotWinner,
    #[msg("Too many players")]
    TooManyPlayers,
}