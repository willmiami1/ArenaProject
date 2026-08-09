export const publicProfilePhoto = (photo) => {
  if (
    !photo ||
    photo.length > 3_000_000 ||
    !/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(photo)
  ) {
    return undefined;
  }
  return photo;
};

export const publicRegisteredRiders = (
  eventId,
  registrations,
  teams,
  contestantsById,
) => {
  const headerEntries = new Map();
  const heelerEntries = new Map();
  const addEntry = (entries, contestantId, horseName) => {
    const horses = entries.get(contestantId) || new Set();
    const normalizedHorseName =
      typeof horseName === "string" ? horseName.trim() : "";
    if (normalizedHorseName) horses.add(normalizedHorseName);
    entries.set(contestantId, horses);
  };
  registrations
    .filter(
      (registration) =>
        registration.eventId === eventId &&
        registration.status !== "scratched",
    )
    .forEach((registration) => {
      addEntry(
        registration.role === "Header" ? headerEntries : heelerEntries,
        registration.contestantId,
        registration.horseName,
      );
    });
  teams
    .filter(
      (team) =>
        team.eventId === eventId &&
        Number(team.round) === 1 &&
        !team.generated &&
        !team.scratched,
    )
    .forEach((team) => {
      addEntry(headerEntries, team.headerId, team.headerHorseName);
      addEntry(heelerEntries, team.heelerId, team.heelerHorseName);
    });

  const projectRiders = (entries) =>
    [...entries]
      .map(([id, horseNames]) => {
        const contestant = contestantsById.get(id);
        return contestant
          ? {
              id: contestant.id,
              name: contestant.name,
              photo: publicProfilePhoto(contestant.photo),
              horseNames: [...horseNames].sort((left, right) =>
                left.localeCompare(right),
              ),
            }
          : undefined;
      })
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name));

  return {
    headers: projectRiders(headerEntries),
    heelers: projectRiders(heelerEntries),
  };
};

export const spectatorPicksAreOpen = (team, now = Date.now()) =>
  !team.scratched &&
  !team.rolled &&
  team.status === "ready" &&
  (!team.predictionClosesAt || Date.parse(team.predictionClosesAt) > now);

const publicPredictionRunIsEligible = (team) =>
  !team.scratched && !team.rolled && team.status === "ready";

export const effectivePublicPredictionState = (event, teams) => {
  const activeRound = Number(event.activeRound);
  const runs = teams
    .filter(
      (team) =>
        team.eventId === event.id &&
        publicPredictionRunIsEligible(team) &&
        (!(activeRound > 0) || Number(team.round) === activeRound),
    )
    .sort(
      (left, right) =>
        Number(left.round) - Number(right.round) ||
        Number(left.drawPosition) - Number(right.drawPosition),
    );
  return {
    runs,
    activeRun:
      runs.find((team) => team.id === event.activeRunId) || runs[0] || null,
  };
};

export const publicPredictionRunProjection = (
  event,
  teams,
  contestantsById,
) => {
  const { runs, activeRun } = effectivePublicPredictionState(event, teams);
  return {
    ...(activeRun ? { activePredictionRunId: activeRun.id } : {}),
    predictionRuns: runs.map((team) => {
      const header = contestantsById.get(team.headerId);
      const heeler = contestantsById.get(team.heelerId);
      return {
        id: team.id,
        round: Number(team.round || 1),
        drawPosition: Number(team.drawPosition),
        headerName: header?.name || "Unknown",
        heelerName: heeler?.name || "Unknown",
        headerPhoto: publicProfilePhoto(header?.photo),
        heelerPhoto: publicProfilePhoto(heeler?.photo),
        steerNumber: team.steerNumber || "",
        closesAt: team.predictionClosesAt,
        open: spectatorPicksAreOpen(team),
      };
    }),
  };
};
