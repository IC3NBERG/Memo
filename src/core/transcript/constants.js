'use strict';

const SCHEMA_VERSIONS = Object.freeze({
  metadata: 2,
  transcript: 2,
  edits: 1,
  manifest: 1,
  searchIndex: 1,
});

const TRANSCRIPT_KINDS = Object.freeze([
  'transcription',
  'translation',
  'livePreview',
]);

const TRANSCRIPT_TIMINGS = Object.freeze([
  'segment',
  'whole-recording',
]);

const DEFAULT_EDITS = Object.freeze({
  segmentText: {},
  hiddenSegmentIds: [],
  tags: {},
  annotations: {},
  order: null,
  groups: [],
});

module.exports = {
  SCHEMA_VERSIONS,
  TRANSCRIPT_KINDS,
  TRANSCRIPT_TIMINGS,
  DEFAULT_EDITS,
};
