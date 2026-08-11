export function showStandaloneRegistrationProfile(
  profileOpen: boolean,
  profileId: string | undefined,
  selectedContestantId: string | undefined,
) {
  return profileOpen && (!profileId || profileId !== selectedContestantId);
}
