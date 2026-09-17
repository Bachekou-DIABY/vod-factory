export const VOD_PROCESSING_QUEUE = 'vod-processing';
export const CLIP_SET_QUEUE = 'clip-set';
export const VOD_DOWNLOAD_QUEUE = 'vod-download';
/** File dédiée : BullMQ ne supporte qu'un worker par nom de queue côté Nest. */
export const VOD_ALIGN_QUEUE = 'vod-align';
export const ANALYZE_CHUNK_JOB = 'analyze-chunk';
export const CLIP_SET_JOB = 'clip-set';
export const VOD_DOWNLOAD_JOB = 'vod-download';
export const ALIGN_VOD_JOB = 'align-vod';
