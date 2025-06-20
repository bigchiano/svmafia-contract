use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;
use std::collections::HashMap;

declare_id!("5t1yHkWXUynBXSvGpz9SZPpE5ewdUAFNk31eRgwqYuPT");

#[program]
pub mod solana_contract {
    use super::*;

    pub fn initialize_game(
        ctx: Context<InitializeGame>,
        game_id: String,
        max_players: u8,
        entry_fee: u64,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let clock = Clock::get()?;
        
        game.game_id = game_id;
        game.creator = ctx.accounts.creator.key();
        game.max_players = max_players;
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
        require!(game.players.len() < game.max_players as usize, ErrorCode::GameFull);
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

        {
            let game = &mut ctx.accounts.game;

            require!(game.state == GameState::Finished, ErrorCode::GameNotFinished);
            require!(game.winner.is_some(), ErrorCode::NoWinner);

            let winner = game.winner.as_ref().unwrap().clone();
            let is_winner = match winner {
                Winner::Mafia => game.players.iter().any(|p| p.address == claimer && p.role == Role::Mafia),
                Winner::Town => game.players.iter().any(|p| p.address == claimer && p.role != Role::Mafia),
            };

            require!(is_winner, ErrorCode::NotWinner);

            // Calculate winnings (simplified)
            let total_pot = game.entry_fee * game.players.len() as u64;
            let winner_count = match winner {
                Winner::Mafia => game.players.iter().filter(|p| p.role == Role::Mafia).count(),
                Winner::Town => game.players.iter().filter(|p| p.role != Role::Mafia).count(),
            } as u64;

            let payout = total_pot / winner_count;

            // Transfer winnings
            **ctx.accounts.game.to_account_info().try_borrow_mut_lamports()? -= payout;
            **ctx.accounts.claimer.to_account_info().try_borrow_mut_lamports()? += payout;

            emit!(WinningsClaimed {
                game_id: ctx.accounts.game.game_id.clone(),
                claimer,
                amount: payout,
            });
        }

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
#[instruction(game_id: String)]
pub struct InitializeGame<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + Game::SPACE,
        seeds = [b"game", game_id.as_bytes()],
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

// Data structures
#[account]
pub struct Game {
    pub game_id: String,
    pub creator: Pubkey,
    pub max_players: u8,
    pub entry_fee: u64,
    pub state: GameState,
    pub current_phase: GamePhase,
    pub day_count: u16,
    pub created_at: i64,
    pub phase_start_time: i64,
    pub players: Vec<Player>,
    pub roles: Vec<Role>,
    pub votes: Vec<Vote>,
    pub eliminated_players: Vec<Pubkey>,
    pub winner: Option<Winner>,
}

impl Game {
    pub const SPACE: usize = 32 + 32 + 1 + 8 + 1 + 1 + 2 + 8 + 8 + 
                             (32 + 1 + 1 + 32 + 8) * 20 + // players (max 20)
                             1 * 20 + // roles
                             (32 + 32 + 8) * 50 + // votes
                             32 * 20 + // eliminated players
                             1 + 1; // winner
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
}