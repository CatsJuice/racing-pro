import { app } from './app';
import type { CarSetup } from './car/setup';
import type { TrackData } from './track/track';

export async function toMenu() {
  const { MenuScreen } = await import('./ui/menu');
  await app.go(new MenuScreen());
}

export async function toTracks() {
  const { TrackListScreen } = await import('./ui/trackList');
  await app.go(new TrackListScreen());
}

export async function toTrackEditor(track?: TrackData) {
  const { TrackEditorScreen } = await import('./ui/trackEditor');
  await app.go(new TrackEditorScreen(track));
}

export async function toGarage(carId?: string) {
  const { GarageScreen } = await import('./ui/garage');
  await app.go(new GarageScreen(carId));
}

export async function toRaceSetup() {
  const { RaceSetupScreen } = await import('./ui/raceSetup');
  await app.go(new RaceSetupScreen());
}

export async function toRace(track: TrackData, car: CarSetup) {
  const { RaceScreen } = await import('./game/race');
  await app.go(new RaceScreen(track, car));
}

export async function toLeaderboard(trackId?: string) {
  const { LeaderboardScreen } = await import('./ui/leaderboard');
  await app.go(new LeaderboardScreen(trackId));
}

export async function toReplay(lapId: string, compareId?: string) {
  const { ReplayScreen } = await import('./replay/replay');
  await app.go(new ReplayScreen(lapId, compareId));
}
