import { Test, TestingModule } from '@nestjs/testing';
import { MediaVideoService } from './media-video.service';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';

jest.mock('fluent-ffmpeg');
jest.mock('fs', () => {
  const original = jest.requireActual('fs');
  return {
    ...original,
    promises: {
      writeFile: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn().mockResolvedValue(Buffer.from('dummy-buffer')),
    },
    existsSync: jest.fn().mockReturnValue(true),
    unlinkSync: jest.fn(),
  };
});

describe('MediaVideoService', () => {
  let service: MediaVideoService;
  let mockFfmpegInstance: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockFfmpegInstance = {
      ffprobe: jest.fn(),
      outputOptions: jest.fn().mockReturnThis(),
      save: jest.fn().mockReturnThis(),
      screenshots: jest.fn().mockReturnThis(),
      on: jest.fn(),
    };

    (ffmpeg as unknown as jest.Mock).mockReturnValue(mockFfmpegInstance);
    (ffmpeg as any).ffprobe = jest.fn((tempInput, cb) => {
      cb(null, { format: { duration: 15 } });
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [MediaVideoService],
    }).compile();

    service = module.get<MediaVideoService>(MediaVideoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processVideo', () => {
    const validMetadata = {
      format: { duration: 30 },
      streams: [{ codec_type: 'video', width: 600, height: 800 }], // 600/800 = 0.75 (3/4)
    };

    it('should reject when ffprobe returns an error', async () => {
      mockFfmpegInstance.ffprobe.mockImplementation((cb: Function) => {
        cb(new Error('ffprobe error'), null);
      });

      await expect(
        service.processVideo(Buffer.from('test-video')),
      ).rejects.toThrow('ffprobe error');
    });

    it('should reject with BadRequestException when metadata or format is missing', async () => {
      mockFfmpegInstance.ffprobe.mockImplementation((cb: Function) => {
        cb(null, null);
      });

      await expect(
        service.processVideo(Buffer.from('test-video')),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject with BadRequestException when duration exceeds 60 seconds', async () => {
      mockFfmpegInstance.ffprobe.mockImplementation((cb: Function) => {
        cb(null, { format: { duration: 61 } });
      });

      await expect(
        service.processVideo(Buffer.from('test-video')),
      ).rejects.toThrow('Video must be 1 minute or less.');
    });

    it('should reject with BadRequestException when aspect ratio is not 3:4', async () => {
      mockFfmpegInstance.ffprobe.mockImplementation((cb: Function) => {
        cb(null, {
          format: { duration: 20 },
          streams: [{ codec_type: 'video', width: 1920, height: 1080 }], // 16:9 ratio
        });
      });

      await expect(
        service.processVideo(Buffer.from('test-video')),
      ).rejects.toThrow('Video must be 3:4 aspect ratio.');
    });

    it('should reject when ffmpeg save emits error', async () => {
      mockFfmpegInstance.ffprobe.mockImplementation((cb: Function) => {
        cb(null, validMetadata);
      });

      mockFfmpegInstance.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'error') {
          handler(new Error('FFmpeg conversion failed'));
        }
        return mockFfmpegInstance;
      });

      await expect(
        service.processVideo(Buffer.from('test-video')),
      ).rejects.toThrow('FFmpeg conversion failed');
    });

    it('should process video and return buffer, duration, and thumbnailBuffer on success', async () => {
      mockFfmpegInstance.ffprobe.mockImplementation((cb: Function) => {
        cb(null, validMetadata);
      });

      // Chain: outputOptions().save().on('end', ...).on('error', ...)
      mockFfmpegInstance.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'end') {
          handler();
        }
        return mockFfmpegInstance;
      });

      const result = await service.processVideo(Buffer.from('test-video'));

      expect(result).toBeDefined();
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.duration).toBe(15000); // from ffprobe static mock (15 * 1000)
      expect(result.thumbnailBuffer).toBeInstanceOf(Buffer);
    });
  });
});
