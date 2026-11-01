import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AvatarService } from './AvatarService';
import { Avatar } from 'model/Avatar.entity';
import { Media } from 'model/media/Media.entity';
import { Client } from 'model/users/Client.entity';
import { MediaService } from '../media/media.service';
import { AwsS3Service } from '../media/aws-s3.service';

describe('AvatarService', () => {
  let service: AvatarService;
  let avatarRepository: any;
  let mediaRepository: any;
  let clientRepository: any;
  let mediaService: any;
  let awsS3Service: any;

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
    avatarRepository = createMockRepository();
    mediaRepository = createMockRepository();
    clientRepository = createMockRepository();
    mediaService = {
      deleteMedia: jest.fn(),
      processAndSaveMedia: jest.fn(),
    };
    awsS3Service = {
      getMediaAccessUrl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AvatarService,
        {
          provide: getRepositoryToken(Avatar),
          useValue: avatarRepository,
        },
        {
          provide: getRepositoryToken(Media),
          useValue: mediaRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: MediaService,
          useValue: mediaService,
        },
        {
          provide: AwsS3Service,
          useValue: awsS3Service,
        },
      ],
    }).compile();

    service = module.get<AvatarService>(AvatarService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAvatar', () => {
    it('should return MinimalAvatarDto when media exists', async () => {
      const mockUserId = 'user-123';
      const mockMedia = {
        id: 'media-123',
        avatar: { id: 'avatar-123' },
      };
      const mockUrl = 'https://s3.amazonaws.com/avatar.jpg';

      mediaRepository.findOne.mockResolvedValueOnce(mockMedia as any);
      awsS3Service.getMediaAccessUrl.mockResolvedValueOnce(mockUrl);

      const result = await service.getAvatar(mockUserId);

      expect(mediaRepository.findOne).toHaveBeenCalledWith({
        where: { avatar: { client: { id: mockUserId } } },
        relations: ['avatar', 'owner', 'photo'],
      });
      expect(awsS3Service.getMediaAccessUrl).toHaveBeenCalledWith(
        mockUserId,
        mockMedia.id,
      );
      expect(result).toEqual({
        id: 'avatar-123',
        mediaId: 'media-123',
        url: mockUrl,
      });
    });

    it('should return null when media is not found', async () => {
      const mockUserId = 'user-123';
      mediaRepository.findOne.mockResolvedValueOnce(null);

      const result = await service.getAvatar(mockUserId);

      expect(mediaRepository.findOne).toHaveBeenCalledWith({
        where: { avatar: { client: { id: mockUserId } } },
        relations: ['avatar', 'owner', 'photo'],
      });
      expect(awsS3Service.getMediaAccessUrl).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should propagate error when mediaRepository throws an error', async () => {
      mediaRepository.findOne.mockRejectedValueOnce(
        new Error('Database error'),
      );
      await expect(service.getAvatar('user-123')).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('createOrUpdateAvatar', () => {
    it('should create new avatar if none exists and delete no existing media', async () => {
      const mockUserId = 'user-123';
      const mockFile = { filename: 'avatar.png' } as any;
      const mockAvatarId = 'avatar-param-id';
      const createdAvatar = { id: 'new-avatar-id', medias: [] };

      avatarRepository.findOne.mockResolvedValueOnce(null);
      avatarRepository.save.mockResolvedValueOnce(createdAvatar as any);
      mediaService.processAndSaveMedia.mockResolvedValueOnce({
        id: 'media-new',
      } as any);

      const result = await service.createOrUpdateAvatar(
        mockUserId,
        mockFile,
        mockAvatarId,
      );

      expect(avatarRepository.findOne).toHaveBeenCalledWith({
        where: { client: { id: mockUserId } },
        relations: ['medias'],
      });
      expect(avatarRepository.save).toHaveBeenCalled();
      expect(mediaService.deleteMedia).not.toHaveBeenCalled();
      expect(mediaService.processAndSaveMedia).toHaveBeenCalledWith(
        mockUserId,
        mockFile,
        null,
        createdAvatar.id,
        null,
      );
      expect(clientRepository.update).toHaveBeenCalledWith(mockUserId, {
        avatar: createdAvatar,
      });
      expect(result).toEqual(createdAvatar);
    });

    it('should delete existing medias when avatar already exists and has medias', async () => {
      const mockUserId = 'user-123';
      const mockFile = { filename: 'avatar.png' } as any;
      const mockAvatarId = 'avatar-param-id';
      const existingAvatar = {
        id: 'existing-avatar-id',
        medias: [{ id: 'media-1' }, { id: 'media-2' }],
      };

      avatarRepository.findOne.mockResolvedValueOnce(existingAvatar as any);
      mediaService.processAndSaveMedia.mockResolvedValueOnce({
        id: 'media-new',
      } as any);

      const result = await service.createOrUpdateAvatar(
        mockUserId,
        mockFile,
        mockAvatarId,
      );

      expect(avatarRepository.save).not.toHaveBeenCalled();
      expect(mediaService.deleteMedia).toHaveBeenCalledTimes(2);
      expect(mediaService.deleteMedia).toHaveBeenCalledWith('media-1');
      expect(mediaService.deleteMedia).toHaveBeenCalledWith('media-2');
      expect(mediaService.processAndSaveMedia).toHaveBeenCalledWith(
        mockUserId,
        mockFile,
        null,
        existingAvatar.id,
        null,
      );
      expect(clientRepository.update).toHaveBeenCalledWith(mockUserId, {
        avatar: existingAvatar,
      });
      expect(result).toEqual(existingAvatar);
    });

    it('should handle existing avatar with null medias', async () => {
      const mockUserId = 'user-123';
      const mockFile = { filename: 'avatar.png' } as any;
      const mockAvatarId = 'avatar-param-id';
      const existingAvatar = {
        id: 'existing-avatar-id',
        medias: null,
      };

      avatarRepository.findOne.mockResolvedValueOnce(existingAvatar as any);
      mediaService.processAndSaveMedia.mockResolvedValueOnce({
        id: 'media-new',
      } as any);

      const result = await service.createOrUpdateAvatar(
        mockUserId,
        mockFile,
        mockAvatarId,
      );

      expect(mediaService.deleteMedia).not.toHaveBeenCalled();
      expect(mediaService.processAndSaveMedia).toHaveBeenCalledWith(
        mockUserId,
        mockFile,
        null,
        existingAvatar.id,
        null,
      );
      expect(clientRepository.update).toHaveBeenCalledWith(mockUserId, {
        avatar: existingAvatar,
      });
      expect(result).toEqual(existingAvatar);
    });

    it('should propagate error when mediaService processAndSaveMedia throws an error', async () => {
      const mockUserId = 'user-123';
      const mockFile = { filename: 'avatar.png' } as any;
      avatarRepository.findOne.mockResolvedValueOnce({
        id: 'avatar-id',
        medias: [],
      } as any);
      mediaService.processAndSaveMedia.mockRejectedValueOnce(
        new Error('Upload failed'),
      );

      await expect(
        service.createOrUpdateAvatar(mockUserId, mockFile, 'avatar-param-id'),
      ).rejects.toThrow('Upload failed');
    });
  });
});
