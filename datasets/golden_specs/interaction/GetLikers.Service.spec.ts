import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetLikersService } from './GetLikers.Service';
import { ClientInteractComment } from 'model/users/relations/ClientInteractComment.entity';
import { ClientInteractTattoo } from 'model/users/relations/ClientInteractTattoo.entity';
import { ClientInteractArtist } from 'model/users/relations/ClientInteractArtist.entity';
import { BasicUserInfoService } from 'modules/users/BasicUserInfo.service';

describe('GetLikersService', () => {
  let service: GetLikersService;
  let clientInteractCommentRepository: any;
  let clientInteractTattooRepository: any;
  let clientInteractArtistRepository: any;
  let basicUserInfoService: any;

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
    clientInteractCommentRepository = createMockRepository();
    clientInteractTattooRepository = createMockRepository();
    clientInteractArtistRepository = createMockRepository();
    basicUserInfoService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetLikersService,
        {
          provide: getRepositoryToken(ClientInteractComment),
          useValue: clientInteractCommentRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractTattoo),
          useValue: clientInteractTattooRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractArtist),
          useValue: clientInteractArtistRepository,
        },
        {
          provide: BasicUserInfoService,
          useValue: basicUserInfoService,
        },
      ],
    }).compile();

    service = module.get<GetLikersService>(GetLikersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getLikesTattoo', () => {
    it('should return list of likers for a tattoo (Happy Path)', async () => {
      // Given
      const mockLikers = [
        { client: { id: 'client-1' } },
        { client: { id: 'client-2' } },
      ];
      const mockUser = { id: 'client-1', name: 'User' };
      clientInteractTattooRepository.find.mockResolvedValueOnce(
        mockLikers as any,
      );
      basicUserInfoService.get.mockResolvedValue(mockUser as any);

      // When
      const result = await service.getLikesTattoo('tattoo-id', 0, 10);

      // Then
      expect(clientInteractTattooRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tattoo: { id: 'tattoo-id' } }),
          skip: 0,
          take: 10,
        }),
      );
      expect(basicUserInfoService.get).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(mockUser);
    });

    it('should return empty array if no likers found', async () => {
      clientInteractTattooRepository.find.mockResolvedValueOnce([]);
      const result = await service.getLikesTattoo('tattoo-id');
      expect(result).toEqual([]);
    });

    it('should propagate errors from repository', async () => {
      clientInteractTattooRepository.find.mockRejectedValueOnce(
        new Error('DB Error'),
      );
      await expect(service.getLikesTattoo('id')).rejects.toThrow('DB Error');
    });
  });

  describe('getLikesProfile', () => {
    it('should return list of likers for a profile (Happy Path)', async () => {
      // Given
      const mockLikers = [{ client: { id: 'client-1' } }];
      const mockUser = { id: 'client-1', name: 'User' };
      clientInteractArtistRepository.find.mockResolvedValueOnce(
        mockLikers as any,
      );
      basicUserInfoService.get.mockResolvedValueOnce(mockUser as any);

      // When
      const result = await service.getLikesProfile('artist-id', 1, 5);

      // Then
      expect(clientInteractArtistRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ artist: { id: 'artist-id' } }),
          skip: 5,
          take: 5,
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should return empty array when no profile likes exist', async () => {
      clientInteractArtistRepository.find.mockResolvedValueOnce([]);
      const result = await service.getLikesProfile('artist-id');
      expect(result).toEqual([]);
    });
  });

  describe('getLikesComment', () => {
    it('should return list of likers for a comment (Happy Path)', async () => {
      // Given
      const mockLikers = [{ client: { id: 'client-1' } }];
      const mockUser = { id: 'client-1', name: 'User' };
      clientInteractCommentRepository.find.mockResolvedValueOnce(
        mockLikers as any,
      );
      basicUserInfoService.get.mockResolvedValueOnce(mockUser as any);

      // When
      const result = await service.getLikesComment('comment-id', 0, 20);

      // Then
      expect(clientInteractCommentRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ comment: { id: 'comment-id' } }),
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should handle repository rejections', async () => {
      clientInteractCommentRepository.find.mockRejectedValueOnce(
        new Error('Query failed'),
      );
      await expect(service.getLikesComment('id')).rejects.toThrow(
        'Query failed',
      );
    });
  });
});
