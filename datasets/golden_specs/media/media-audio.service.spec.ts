import { Test, TestingModule } from '@nestjs/testing';
import { MediaAudioService } from './media-audio.service';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';

// Mock dependencies
jest.mock('fluent-ffmpeg', () => {
  const mockCommand = {
    outputOptions: jest.fn().mockReturnThis(),
    save: jest.fn().mockReturnThis(),
    on: jest.fn().mockImplementation(function (event, cb) {
      if (event === 'end') {
        // Simulate async end
        setTimeout(cb, 0);
      }
      return this;
    }),
    pipe: jest.fn().mockReturnValue({
      on: jest.fn().mockImplementation(function (event, cb) {
        if (event === 'end') {
          setTimeout(cb, 0);
        }
        return this;
      }),
    }),
  };

  const mockFfmpeg = jest.fn(() => mockCommand);
  (mockFfmpeg as any).ffprobe = jest.fn((path, cb) => {
    cb(null, { streams: [{ codec_type: 'audio' }], format: { duration: 10 } });
  });

  return { __esModule: true, default: mockFfmpeg };
});

jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    promises: {
      ...originalFs.promises,
      writeFile: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn().mockResolvedValue(Buffer.from('mock-audio')),
    },
    existsSync: jest.fn().mockReturnValue(true),
    unlinkSync: jest.fn(),
  };
});

describe('MediaAudioService', () => {
  let service: MediaAudioService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MediaAudioService],
    }).compile();

    service = module.get<MediaAudioService>(MediaAudioService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processAudio', () => {
    it('should execute processAudio successfully', async () => {
      // Given (Arrange)
      // Configure injected repository/service mocks if needed

      // When (Act)
      const result = await service.processAudio(Buffer.from('test-val'));

      // Then (Assert)
      expect(result).toBeDefined();
      expect(result.buffer).toBeDefined();
      expect(result.waveform).toBeDefined();
      expect(result.duration).toBe(10000); // 10 * 1000
    });
  });
});
