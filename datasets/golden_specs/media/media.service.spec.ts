import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MediaService } from './media.service';
import { Media } from '../../model/media/Media.entity';
import { Client } from '../../model/users/Client.entity';
import { AwsS3Service } from './aws-s3.service';
import { MediaImageService } from './services/media-image.service';
import { MediaVideoService } from './services/media-video.service';
import { MediaAudioService } from './services/media-audio.service';
import { MediaPermissionService } from './services/media-permission.service';
import {
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { MediaTypeEnum } from 'enums/FileTypeEnum';

describe('MediaService', () => {
  let service: MediaService;
  let mediaRepository: any;
  let clientRepository: any;
  let awsS3Service: any;
  let mediaImageService: any;
  let mediaVideoService: any;
  let mediaAudioService: any;
  let mediaPermissionService: any;

  beforeEach(async () => {
    const createQueryBuilderMock = () => {
      const qb: any = new Proxy(
        {},
        {
          get(target, prop) {
            if (prop === 'then') return undefined;
            if (!(prop in target)) {
              target[prop] = jest.fn().mockImplementation((...args: any[]) => {
                if (args.length > 0 && typeof args[0] === 'function') {
                  args[0](qb);
                } else if (
                  args.length > 0 &&
                  args[0] &&
                  typeof args[0].whereFactory === 'function'
                ) {
                  args[0].whereFactory(qb);
                }
                return qb;
              });
            }
            return target[prop];
          },
        },
      );
      qb.getOne = jest.fn().mockResolvedValue(null);
      qb.getMany = jest.fn().mockResolvedValue([]);
      qb.getRawOne = jest.fn().mockResolvedValue(null);
      qb.getRawMany = jest.fn().mockResolvedValue([]);
      qb.getCount = jest.fn().mockResolvedValue(0);
      qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      qb.execute = jest.fn().mockResolvedValue({ affected: 1, raw: [] });
      return qb;
    };

    const createMockRepository = () => {
      const qb = createQueryBuilderMock();
      return {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([]),
        findAndCount: jest.fn().mockResolvedValue([[], 0]),
        save: jest
          .fn()
          .mockImplementation((e: any) =>
            Promise.resolve({ id: 'mock-id', ...(e || {}) }),
          ),
        create: jest.fn().mockImplementation((e: any) => e),
        update: jest
          .fn()
          .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
        delete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        softDelete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        restore: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        count: jest.fn().mockResolvedValue(0),
        exist: jest.fn().mockResolvedValue(false),
        remove: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
    };
    mediaRepository = createMockRepository();
    clientRepository = createMockRepository();
    awsS3Service = {
      downloadJsonFile: jest.fn(),
      getMediaAccessUrl: jest.fn(),
      getMediaThumbnailAccessUrl: jest.fn(),
      uploadToS3: jest.fn(),
    };
    mediaImageService = {
      processImage: jest.fn(),
    };
    mediaVideoService = {
      processVideo: jest.fn(),
    };
    mediaAudioService = {
      processAudio: jest.fn(),
    };
    mediaPermissionService = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        {
          provide: getRepositoryToken(Media),
          useValue: mediaRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: AwsS3Service,
          useValue: awsS3Service,
        },
        {
          provide: MediaImageService,
          useValue: mediaImageService,
        },
        {
          provide: MediaVideoService,
          useValue: mediaVideoService,
        },
        {
          provide: MediaAudioService,
          useValue: mediaAudioService,
        },
        {
          provide: MediaPermissionService,
          useValue: mediaPermissionService,
        },
      ],
    }).compile();

    service = module.get<MediaService>(MediaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processAndSaveMedia', () => {
    const mockFile = {
      mimetype: 'image/png',
      buffer: Buffer.from('test'),
    } as any;

    it('should throw NotFoundException if client does not exist', async () => {
      clientRepository.findOne.mockResolvedValue(null);
      await expect(
        service.processAndSaveMedia(
          'user-1',
          mockFile,
          'chat-1',
          'avatar-1',
          'photo-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should process and save image successfully', async () => {
      clientRepository.findOne.mockResolvedValue({ id: 'user-1' } as any);
      mediaImageService.processImage.mockResolvedValue({
        buffer: Buffer.from('processed'),
      });

      const result = await service.processAndSaveMedia(
        'user-1',
        mockFile,
        'chat-1',
        'avatar-1',
        'photo-1',
      );

      expect(mediaRepository.save).toHaveBeenCalled();
      expect(result.type).toBe(MediaTypeEnum.IMAGE);
    });

    it('should process and save video successfully', async () => {
      clientRepository.findOne.mockResolvedValue({ id: 'user-1' } as any);
      const videoFile = {
        mimetype: 'video/mp4',
        buffer: Buffer.from('test'),
      } as any;
      mediaVideoService.processVideo.mockResolvedValue({
        buffer: Buffer.from('processed'),
        duration: 10,
        thumbnailBuffer: Buffer.from('thumb'),
      });

      const result = await service.processAndSaveMedia(
        'user-1',
        videoFile,
        'chat-1',
        'avatar-1',
        'photo-1',
      );

      expect(mediaRepository.save).toHaveBeenCalled();
      expect(result.type).toBe(MediaTypeEnum.VIDEO);
    });

    it('should process and save audio successfully', async () => {
      clientRepository.findOne.mockResolvedValue({ id: 'user-1' } as any);
      const audioFile = {
        mimetype: 'audio/mpeg',
        buffer: Buffer.from('test'),
      } as any;
      mediaAudioService.processAudio.mockResolvedValue({
        buffer: Buffer.from('processed'),
        duration: 5,
        waveform: Buffer.from('wave'),
      });

      const result = await service.processAndSaveMedia(
        'user-1',
        audioFile,
        'chat-1',
        'avatar-1',
        'photo-1',
      );

      expect(mediaRepository.save).toHaveBeenCalled();
      expect(result.type).toBe(MediaTypeEnum.AUDIO);
    });

    it('should throw InternalServerErrorException if processing fails', async () => {
      clientRepository.findOne.mockResolvedValue({ id: 'user-1' } as any);
      mediaImageService.processImage.mockRejectedValue(
        new Error('Processing failed'),
      );

      await expect(
        service.processAndSaveMedia(
          'user-1',
          mockFile,
          'chat-1',
          'avatar-1',
          'photo-1',
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('toDtoList', () => {
    it('should map media entities to DTOs', async () => {
      const mockMedia = [
        {
          id: 'm1',
          type: MediaTypeEnum.IMAGE,
          path: 'path/to/img',
          duration: 0,
        } as any,
      ];
      awsS3Service.getMediaAccessUrl.mockResolvedValue('http://url');

      const result = await service.toDtoList('user-1', mockMedia);

      expect(result).toHaveLength(1);
      expect(result[0].url).toBe('http://url');
    });

    it('should fetch waveform for audio media', async () => {
      const mockMedia = [
        {
          id: 'm1',
          type: MediaTypeEnum.AUDIO,
          path: 'path/to/audio.aac',
          duration: 10,
        } as any,
      ];
      awsS3Service.getMediaAccessUrl.mockResolvedValue('http://url');
      awsS3Service.downloadJsonFile.mockResolvedValue(['wave-data']);

      const result = await service.toDtoList('user-1', mockMedia);

      expect(awsS3Service.downloadJsonFile).toHaveBeenCalled();
      expect(result[0].wave).toEqual(['wave-data']);
    });
  });

  describe('deleteMedia', () => {
    it('should delete media successfully', async () => {
      mediaRepository.findOne.mockResolvedValue({ id: 'm1' } as any);

      await service.deleteMedia('m1');

      expect(mediaRepository.softDelete).toHaveBeenCalledWith({ id: 'm1' });
    });

    it('should throw NotFoundException if media not found', async () => {
      mediaRepository.findOne.mockResolvedValue(null);

      await expect(service.deleteMedia('m1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateMediaPhoto', () => {
    it('should update media photo successfully', async () => {
      await service.updateMediaPhoto('m1', 'new-photo-id');

      expect(mediaRepository.update).toHaveBeenCalledWith('m1', {
        photo: 'new-photo-id',
      });
    });
  });
});
