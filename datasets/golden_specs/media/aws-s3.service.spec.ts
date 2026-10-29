import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AwsS3Service } from './aws-s3.service';
import { Media } from '../../model/media/Media.entity';
import { MediaPermissionService } from './services/media-permission.service';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');

describe('AwsS3Service', () => {
  let service: AwsS3Service;
  let mediaRepository: any;
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
    mediaPermissionService = {
      hasPermission: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AwsS3Service,
        {
          provide: getRepositoryToken(Media),
          useValue: mediaRepository,
        },
        {
          provide: MediaPermissionService,
          useValue: mediaPermissionService,
        },
      ],
    }).compile();

    service = module.get<AwsS3Service>(AwsS3Service);

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadToS3', () => {
    it('should upload file to S3 successfully', async () => {
      const s3SendSpy = jest
        .spyOn(S3Client.prototype, 'send')
        .mockImplementation(() => Promise.resolve({} as any));

      const result = await service.uploadToS3(
        Buffer.from('test'),
        'path/to/file',
        'image/png',
      );

      expect(s3SendSpy).toHaveBeenCalledWith(expect.any(PutObjectCommand));
      expect(result).toContain('path/to/file');
    });

    it('should throw error when S3 upload fails', async () => {
      jest
        .spyOn(S3Client.prototype, 'send')
        .mockImplementation(() => Promise.reject(new Error('S3 Error')));

      await expect(
        service.uploadToS3(Buffer.from('test'), 'path', 'image/png'),
      ).rejects.toThrow('S3 Error');
    });
  });

  describe('_getPresignedUrl', () => {
    it('should return a signed URL', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue('https://signed-url.com');

      const result = await (service as any)._getPresignedUrl('path/to/file');

      expect(result).toBe('https://signed-url.com');
      expect(getSignedUrl).toHaveBeenCalled();
    });

    it('should return cached URL if valid', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue('https://signed-url.com');

      // First call to cache it
      await (service as any)._getPresignedUrl('path/to/file');

      // Second call
      const result = await (service as any)._getPresignedUrl('path/to/file');

      expect(result).toBe('https://signed-url.com');
      expect(getSignedUrl).toHaveBeenCalledTimes(1);
    });
  });

  describe('downloadJsonFile', () => {
    it('should download and parse JSON file', async () => {
      const mockData = { key: 'value' };
      jest.spyOn(S3Client.prototype, 'send').mockImplementation(() =>
        Promise.resolve({
          Body: {
            transformToString: jest
              .fn()
              .mockResolvedValue(JSON.stringify(mockData)),
          },
        } as any),
      );

      const result = await service.downloadJsonFile('path/to/file.json');

      expect(result).toEqual(mockData);
    });
  });

  describe('deleteFromS3', () => {
    it('should call delete command', async () => {
      const s3SendSpy = jest
        .spyOn(S3Client.prototype, 'send')
        .mockImplementation(() => Promise.resolve({} as any));

      await service.deleteFromS3('path/to/file');

      expect(s3SendSpy).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    });
  });

  describe('getMediaAccessUrl', () => {
    it('should throw BadRequestException if inputs are missing', async () => {
      await expect(
        service.getMediaAccessUrl(null as any, 'id'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if media does not exist', async () => {
      mediaRepository.findOne.mockResolvedValue(null);
      await expect(
        service.getMediaAccessUrl('user-id', 'media-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnauthorizedException if no permission', async () => {
      mediaRepository.findOne.mockResolvedValue({
        id: 'media-id',
        path: 'path',
      } as any);
      mediaPermissionService.hasPermission.mockResolvedValue(false);

      await expect(
        service.getMediaAccessUrl('user-id', 'media-id'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return presigned URL on success', async () => {
      mediaRepository.findOne.mockResolvedValue({
        id: 'media-id',
        path: 'path',
      } as any);
      mediaPermissionService.hasPermission.mockResolvedValue(true);
      (getSignedUrl as jest.Mock).mockResolvedValue('https://signed-url.com');

      const result = await service.getMediaAccessUrl('user-id', 'media-id');

      expect(result).toBe('https://signed-url.com');
    });
  });

  describe('getMediaThumbnailAccessUrl', () => {
    it('should throw BadRequestException if inputs are missing', async () => {
      await expect(
        service.getMediaThumbnailAccessUrl('user-id', null as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return undefined if thumbnailPath is missing', async () => {
      mediaRepository.findOne.mockResolvedValue({
        id: 'media-id',
        thumbnailPath: null,
      } as any);
      mediaPermissionService.hasPermission.mockResolvedValue(true);

      const result = await service.getMediaThumbnailAccessUrl(
        'user-id',
        'media-id',
      );

      expect(result).toBeUndefined();
    });

    it('should return presigned URL for thumbnail on success', async () => {
      mediaRepository.findOne.mockResolvedValue({
        id: 'media-id',
        thumbnailPath: 'thumb-path',
      } as any);
      mediaPermissionService.hasPermission.mockResolvedValue(true);
      (getSignedUrl as jest.Mock).mockResolvedValue('https://thumb-url.com');

      const result = await service.getMediaThumbnailAccessUrl(
        'user-id',
        'media-id',
      );

      expect(result).toBe('https://thumb-url.com');
    });
  });
});
