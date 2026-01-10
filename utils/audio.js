import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { Readable } from 'stream';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Configure ffmpeg binary
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Convert arbitrary audio buffer (e.g. webm/ogg/opus) to 16-bit linear PCM WAV
 * with 16kHz sample rate and mono channel.
 *
 * @param {Buffer} inputBuffer - Original audio buffer
 * @param {string} inputFormat - Hint for input format (e.g. 'webm', 'ogg')
 * @returns {Promise<Buffer>} - Converted WAV buffer
 */
export const convertToLinear16Wav = (inputBuffer, inputFormat = 'webm') => {
  const attempt = (useFormatHint = true) =>
    new Promise((resolve, reject) => {
      try {
        const inputStream = new Readable({
          read() {
            this.push(inputBuffer);
            this.push(null);
          }
        });

        const chunks = [];

        let command = ffmpeg(inputStream)
          // Audio settings
          .audioCodec('pcm_s16le') // 16-bit linear PCM
          .audioFrequency(16000)   // 16kHz
          .audioChannels(1)        // Mono
          .format('wav')
          .on('error', (err) => {
            console.error('[Audio] ffmpeg conversion error:', err.message, 'useFormatHint:', useFormatHint);
            reject(new Error(`Audio conversion failed: ${err.message}`));
          })
          .on('end', () => {
            const outputBuffer = Buffer.concat(chunks);
            console.log('[Audio] ffmpeg conversion complete:', {
              inputSize: inputBuffer.length,
              outputSize: outputBuffer.length,
              useFormatHint
            });
            resolve(outputBuffer);
          });

        if (useFormatHint && inputFormat) {
          command = command.inputFormat(inputFormat).inputOptions([`-f ${inputFormat}`]);
        }

        command.pipe().on('data', (chunk) => chunks.push(chunk));
      } catch (err) {
        console.error('[Audio] Conversion exception:', err);
        reject(new Error(`Audio conversion failed: ${err.message}`));
      }
    });

  // Try with format hint first, then without as fallback
  return attempt(true)
    .catch(() => attempt(false))
    .catch(async (err) => {
      console.warn('[Audio] In-memory conversion failed, trying temp file approach:', err.message);
      // Temp file approach to give ffmpeg a real file to probe
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-audio-'));
      const inputExt = inputFormat === 'ogg' ? '.ogg' : '.webm';
      const inputPath = path.join(tmpDir, `${uuidv4()}${inputExt}`);
      const outputPath = path.join(tmpDir, `${uuidv4()}.wav`);
      try {
        await fs.writeFile(inputPath, inputBuffer);
        await new Promise((resolveFile, rejectFile) => {
          ffmpeg(inputPath)
            .inputOptions(['-y'])
            .audioCodec('pcm_s16le')
            .audioFrequency(16000)
            .audioChannels(1)
            .format('wav')
            .on('error', (ffErr) => {
              console.error('[Audio] ffmpeg temp-file conversion error:', ffErr.message);
              rejectFile(new Error(`Audio conversion failed: ${ffErr.message}`));
            })
            .on('end', resolveFile)
            .save(outputPath);
        });
        const outputBuffer = await fs.readFile(outputPath);
        console.log('[Audio] ffmpeg temp-file conversion complete:', {
          inputSize: inputBuffer.length,
          outputSize: outputBuffer.length
        });
        return outputBuffer;
      } finally {
        // Cleanup temp files
        try { await fs.unlink(inputPath); } catch {}
        try { await fs.unlink(outputPath); } catch {}
        try { await fs.rmdir(tmpDir); } catch {}
      }
    });
};



