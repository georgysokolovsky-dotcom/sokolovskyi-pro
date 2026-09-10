export function createLocalPlaybackSourceProvider() {
  return Object.freeze({
    name: 'local',
    createPlaybackSource({ user, webinar, issueMediaToken }) {
      const media = issueMediaToken(user, webinar);
      return {
        videoProvider: 'native-html5',
        videoUrl: `/v1/webinar/media/${encodeURIComponent(webinar.videoId)}?mt=${encodeURIComponent(media.token)}`,
        playbackExpiresAt: media.expiresAt,
      };
    },
  });
}
