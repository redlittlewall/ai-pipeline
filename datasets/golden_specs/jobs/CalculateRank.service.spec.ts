import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CalculateRankService } from './CalculateRank.service';
import { Artist } from 'model/users/Artist.entity';
import { CalculatePhotoPointsService } from './CalculatePhotoPoints.service';
import { CalculateArtistPointsService } from './CalculateArtistPoints.service';
import { CalculateCommentPointsService } from './CalculateCommentPoints.service';

describe('CalculateRankService', () => {
  let service: CalculateRankService;
  let artistRepository: any;
  let calculatePhotoPointsService: any;
  let calculateArtistPointsService: any;
  let calculateCommentPointsServiceService: any;

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
    artistRepository = createMockRepository();
    calculatePhotoPointsService = {
      call: jest.fn(),
    };
    calculateArtistPointsService = {
      call: jest.fn(),
    };
    calculateCommentPointsServiceService = {
      call: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalculateRankService,
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: CalculatePhotoPointsService,
          useValue: calculatePhotoPointsService,
        },
        {
          provide: CalculateArtistPointsService,
          useValue: calculateArtistPointsService,
        },
        {
          provide: CalculateCommentPointsService,
          useValue: calculateCommentPointsServiceService,
        },
      ],
    }).compile();

    service = module.get<CalculateRankService>(CalculateRankService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processArtists', () => {
    it('should process artists in pages until no artists are returned', async () => {
      // Arrange
      const mockArtistsPage1 = [{ id: '1' }, { id: '2' }] as any;
      const mockArtistsPage2 = [{ id: '3' }] as any;

      artistRepository.find
        .mockResolvedValueOnce(mockArtistsPage1)
        .mockResolvedValueOnce(mockArtistsPage2)
        .mockResolvedValueOnce([]);

      // Act
      await service.processArtists();

      // Assert
      expect(artistRepository.find).toHaveBeenCalledTimes(3);
      expect(artistRepository.find).toHaveBeenNthCalledWith(1, {
        skip: 0,
        take: 30,
      });
      expect(artistRepository.find).toHaveBeenNthCalledWith(2, {
        skip: 30,
        take: 30,
      });
      expect(artistRepository.find).toHaveBeenNthCalledWith(3, {
        skip: 60,
        take: 30,
      });
    });

    it('should stop immediately if no artists are found', async () => {
      // Arrange
      artistRepository.find.mockResolvedValueOnce([]);

      // Act
      await service.processArtists();

      // Assert
      expect(artistRepository.find).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors when repository fails', async () => {
      // Arrange
      artistRepository.find.mockRejectedValueOnce(new Error('DB Error'));

      // Act & Assert
      await expect(service.processArtists()).rejects.toThrow('DB Error');
    });
  });

  describe('calculateRank', () => {
    it('should execute calculateRank successfully', async () => {
      // Given (Arrange)
      const mockArtist = { id: '123' } as any;

      // When (Act)
      const result = await service.calculateRank(mockArtist);

      // Then (Assert)
      expect(result).toBeUndefined();
    });
  });
});
