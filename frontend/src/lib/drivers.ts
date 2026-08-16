/**
 * Grid identity for every driver the cached sessions can return.
 *
 * The backend only ever sends a three-letter code. Everything a viewer needs to
 * recognise who they are looking at — name, car number, team, livery colour,
 * helmet scheme — lives here, so switching driver produces a visibly different
 * screen rather than three different letters.
 *
 * `helmet` is a three-stop scheme in the spirit of each driver's real lid. It is
 * an evocation, not a reproduction: enough to make HAM and VER unmistakable at a
 * glance, drawn entirely in SVG so nothing has to be fetched at runtime.
 */

export interface Team {
  name: string
  /** Livery colour — used for the accent bar, glow and circuit trace. */
  color: string
  /** Readable text colour on top of `color`. */
  ink: string
}

export interface Driver {
  code: string
  first: string
  last: string
  number: number
  team: Team
  /** [shell, stripe, accent] */
  helmet: [string, string, string]
}

const TEAMS = {
  redbull: { name: 'Red Bull Racing', color: '#3671C6', ink: '#ffffff' },
  mercedes: { name: 'Mercedes', color: '#27F4D2', ink: '#04211c' },
  ferrari: { name: 'Ferrari', color: '#E8002D', ink: '#ffffff' },
  mclaren: { name: 'McLaren', color: '#FF8000', ink: '#1a0d00' },
  aston: { name: 'Aston Martin', color: '#229971', ink: '#ffffff' },
  alpine: { name: 'Alpine', color: '#2C8FE0', ink: '#ffffff' },
  williams: { name: 'Williams', color: '#64C4FF', ink: '#00131f' },
  rb: { name: 'RB', color: '#6692FF', ink: '#050b1c' },
  sauber: { name: 'Kick Sauber', color: '#52E252', ink: '#041a04' },
  haas: { name: 'Haas F1 Team', color: '#E6002B', ink: '#ffffff' },
} satisfies Record<string, Team>

export const DRIVERS: Record<string, Driver> = {
  VER: { code: 'VER', first: 'Max', last: 'Verstappen', number: 1, team: TEAMS.redbull, helmet: ['#0A1E5C', '#E4002B', '#FFC400'] },
  PER: { code: 'PER', first: 'Sergio', last: 'Pérez', number: 11, team: TEAMS.redbull, helmet: ['#F2F2F2', '#E4002B', '#0B7A3B'] },
  HAM: { code: 'HAM', first: 'Lewis', last: 'Hamilton', number: 44, team: TEAMS.mercedes, helmet: ['#F7E600', '#FFFFFF', '#101010'] },
  RUS: { code: 'RUS', first: 'George', last: 'Russell', number: 63, team: TEAMS.mercedes, helmet: ['#111418', '#2F6FEA', '#F2F2F2'] },
  LEC: { code: 'LEC', first: 'Charles', last: 'Leclerc', number: 16, team: TEAMS.ferrari, helmet: ['#F4F4F4', '#E8002D', '#FFC400'] },
  SAI: { code: 'SAI', first: 'Carlos', last: 'Sainz', number: 55, team: TEAMS.ferrari, helmet: ['#E10600', '#FFC400', '#141414'] },
  NOR: { code: 'NOR', first: 'Lando', last: 'Norris', number: 4, team: TEAMS.mclaren, helmet: ['#D6FF00', '#FF8000', '#101010'] },
  PIA: { code: 'PIA', first: 'Oscar', last: 'Piastri', number: 81, team: TEAMS.mclaren, helmet: ['#0C2340', '#47C7F4', '#FF8000'] },
  ALO: { code: 'ALO', first: 'Fernando', last: 'Alonso', number: 14, team: TEAMS.aston, helmet: ['#1B3A8C', '#FFD200', '#E4002B'] },
  STR: { code: 'STR', first: 'Lance', last: 'Stroll', number: 18, team: TEAMS.aston, helmet: ['#101418', '#E4002B', '#F2F2F2'] },
  OCO: { code: 'OCO', first: 'Esteban', last: 'Ocon', number: 31, team: TEAMS.alpine, helmet: ['#12203A', '#2C8FE0', '#F2F2F2'] },
  GAS: { code: 'GAS', first: 'Pierre', last: 'Gasly', number: 10, team: TEAMS.alpine, helmet: ['#F2F2F2', '#1B3A8C', '#E4002B'] },
  ALB: { code: 'ALB', first: 'Alexander', last: 'Albon', number: 23, team: TEAMS.williams, helmet: ['#F2F2F2', '#1B3A8C', '#E4002B'] },
  SAR: { code: 'SAR', first: 'Logan', last: 'Sargeant', number: 2, team: TEAMS.williams, helmet: ['#12244A', '#E4002B', '#F2F2F2'] },
  COL: { code: 'COL', first: 'Franco', last: 'Colapinto', number: 43, team: TEAMS.williams, helmet: ['#6CACE4', '#F2F2F2', '#FFC400'] },
  TSU: { code: 'TSU', first: 'Yuki', last: 'Tsunoda', number: 22, team: TEAMS.rb, helmet: ['#F2F2F2', '#E4002B', '#101010'] },
  RIC: { code: 'RIC', first: 'Daniel', last: 'Ricciardo', number: 3, team: TEAMS.rb, helmet: ['#141414', '#FFC400', '#F2F2F2'] },
  LAW: { code: 'LAW', first: 'Liam', last: 'Lawson', number: 40, team: TEAMS.rb, helmet: ['#101010', '#C8CDD4', '#2F6FEA'] },
  BOT: { code: 'BOT', first: 'Valtteri', last: 'Bottas', number: 77, team: TEAMS.sauber, helmet: ['#F2F2F2', '#1B75BB', '#101010'] },
  ZHO: { code: 'ZHO', first: 'Guanyu', last: 'Zhou', number: 24, team: TEAMS.sauber, helmet: ['#E4002B', '#FFC400', '#101010'] },
  MAG: { code: 'MAG', first: 'Kevin', last: 'Magnussen', number: 20, team: TEAMS.haas, helmet: ['#E6002B', '#F2F2F2', '#101010'] },
  HUL: { code: 'HUL', first: 'Nico', last: 'Hülkenberg', number: 27, team: TEAMS.haas, helmet: ['#141414', '#E6002B', '#D4AF37'] },
}

const UNKNOWN_TEAM: Team = { name: 'Unlisted entry', color: '#8A93A3', ink: '#0b0d11' }

/**
 * Freely-licensed portrait shipped under `public/drivers/`.
 *
 * Wikimedia Commons, not F1 press imagery — see `public/drivers/CREDITS.md` for
 * the per-driver licence. Null for any code we have no card for, in which case
 * the helmet stands in.
 */
export const portraitUrl = (code: string): string | null =>
  DRIVERS[code] ? `/drivers/${code}.jpg` : null

/** Never throws: a code we have no card for still gets a usable identity. */
export function getDriver(code: string): Driver {
  return (
    DRIVERS[code] ?? {
      code,
      first: '',
      last: code,
      number: 0,
      team: UNKNOWN_TEAM,
      helmet: ['#2A2F38', '#8A93A3', '#C8CDD4'],
    }
  )
}
