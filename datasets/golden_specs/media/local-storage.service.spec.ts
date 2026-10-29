import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LocalStorageService } from './local-storage.service';
import { Media } from '../../model/media/Media.entity';
import { MediaPermissionService } from './services/media-permission.service';
import * as fs from 'fs';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

jest.mock('fs');

describe('LocalStorageService', () => {
  let service: LocalStorageService;
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
        LocalStorageService,
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

    service = module.get<LocalStorageService>(LocalStorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadToS3', () => {
    it('should save file locally and return the URL', async () => {
      const buffer = Buffer.from('test');
      const filePath = 'test.jpg';
      const mimetype = 'image/jpeg';

      const result = await service.uploadToS3(buffer, filePath, mimetype);

      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(result).toContain(filePath);
    });

    it('should throw error if file system operation fails', async () => {
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Disk full');
      });

      await expect(
        service.uploadToS3(Buffer.from(''), 'test.jpg', 'image/jpeg'),
      ).rejects.toThrow('Disk full');
    });
  });

  describe('_getPresignedUrl', () => {
    it('should return the correct URL format', async () => {
      const filePath = 'test.jpg';
      const result = await service._getPresignedUrl(filePath);
      expect(result).toContain(filePath);
    });
  });

  describe('deleteFromS3', () => {
    it('should delete file if it exists', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      await service.deleteFromS3('test.jpg');
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should not attempt to delete if file does not exist', async () => {
      jest.clearAllMocks();
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      await service.deleteFromS3('test.jpg');
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('getFilePath', () => {
    it('should return path if file exists', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const result = service.getFilePath('test.jpg');
      expect(result).toBeDefined();
    });

    it('should return null if file does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const result = service.getFilePath('test.jpg');
      expect(result).toBeNull();
    });
  });

  describe('getMediaAccessUrl', () => {
    it('should throw BadRequestException if userId or mediaId is missing', async () => {
      await expect(service.getMediaAccessUrl('', 'id')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if media does not exist', async () => {
      mediaRepository.findOne.mockResolvedValue(null);
      await expect(
        service.getMediaAccessUrl('user1', 'media1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnauthorizedException if user has no permission', async () => {
      mediaRepository.findOne.mockResolvedValue({
        id: 'media1',
        path: 'test.jpg',
      } as any);
      mediaPermissionService.hasPermission.mockResolvedValue(false);
      await expect(
        service.getMediaAccessUrl('user1', 'media1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return URL if permission is granted', async () => {
      mediaRepository.findOne.mockResolvedValue({
        id: 'media1',
        path: 'test.jpg',
      } as any);
      mediaPermissionService.hasPermission.mockResolvedValue(true);
      const result = await service.getMediaAccessUrl('user1', 'media1');
      expect(result).toContain('test.jpg');
    });
  });

  describe('getMediaThumbnailAccessUrl', () => {
    it('should throw BadRequestException if userId or mediaId is missing', async () => {
      await expect(
        service.getMediaThumbnailAccessUrl('', 'id'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if media does not exist', async () => {
      mediaRepository.findOne.mockResolvedValue(null);
      await expect(
        service.getMediaThumbnailAccessUrl('user1', 'media1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnauthorizedException if user has no permission', async () => {
      mediaRepository.findOne.mockResolvedValue({
        id: 'media1',
        path: 'test.jpg',
      } as any);
      mediaPermissionService.hasPermission.mockResolvedValue(false);
      await expect(
        service.getMediaThumbnailAccessUrl('user1', 'media1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return thumbnail URL if permission is granted', async () => {
      mediaRepository.findOne.mockResolvedValue({
        id: 'media1',
        path: 'test.jpg',
      } as any);
      mediaPermissionService.hasPermission.mockResolvedValue(true);
      const result = await service.getMediaThumbnailAccessUrl(
        'user1',
        'media1',
      );
      expect(result).toContain('test.thumbnail.jpg');
    });
  });
});
