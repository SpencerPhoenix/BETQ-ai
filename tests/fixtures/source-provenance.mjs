// Synthetic unit-test provenance only. Never publish as collected evidence.
export const sourceProvenance=verifiedAt=>({
  verifiedAt,
  communitySourceVintage:{sha256:'b'.repeat(64),collectorObservedAt:verifiedAt,
    publicationTimeVerified:false}
});
