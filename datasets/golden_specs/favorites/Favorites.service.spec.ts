import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FavoritesService } from './Favorites.service';
import { ClientInteractArtist } from 'model/users/relations/ClientInteractArtist.entity';
import { ClientInteractTattoo } from 'model/users/relations/ClientInteractTattoo.entity';
import { ClientInteractHashtag } from 'model/hashtag/ClientInteractHashtag.entity';
import { GetArtistDetailService } from 'modules/search/GetArtistDetail.Service';
import { GetTattooMinimalService } from 'modules/tattoo/GetTattooMinimal.Service';
import { GetHashtagDetailService } from 'modules/search/GetHashtagDetail.Service';

describe('FavoritesService', () => {
  let service: FavoritesService;
  let clientInteractArtistRepository: any;
  let clientInteractTattooRepository: any;
  let clientInteractHashtagRepository: any;
  let getArtistDetailService: any;
  let getTattooMinimalService: any;
  let getHashtagDetailService: any;

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
    clientInteractArtistRepository = createMockRepository();
    clientInteractTattooRepository = createMockRepository();
    clientInteractHashtagRepository = createMockRepository();
    getArtistDetailService = {
      getArtistDetails: jest.fn(),
    };
    getTattooMinimalService = {
      getMinimal: jest.fn(),
    };
    getHashtagDetailService = {
      getHashtagSearchDetail: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FavoritesService,
        {
          provide: getRepositoryToken(ClientInteractArtist),
          useValue: clientInteractArtistRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractTattoo),
          useValue: clientInteractTattooRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractHashtag),
          useValue: clientInteractHashtagRepository,
        },
        {
          provide: GetArtistDetailService,
          useValue: getArtistDetailService,
        },
        {
          provide: GetTattooMinimalService,
          useValue: getTattooMinimalService,
        },
        {
          provide: GetHashtagDetailService,
          useValue: getHashtagDetailService,
        },
      ],
    }).compile();

    service = module.get<FavoritesService>(FavoritesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getArtists', () => {
    it('should execute getArtists successfully and return artist details (Happy Path)', async () => {
      // Given (Arrange)
      const mockInteractions = [
        {
          id: 'inter-1',
          artist: { id: 'artist-1' },
          client: { id: 'client-1' },
        },
      ];
      const mockArtistDetail = {
        artist: { id: 'artist-1', name: 'Artist Name' },
      };

      clientInteractArtistRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce(mockInteractions as any);
      getArtistDetailService.getArtistDetails.mockResolvedValueOnce(
        mockArtistDetail as any,
      );

      // When (Act)
      const result = await service.getArtists('client-1', 0, 10);

      // Then (Assert)
      expect(
        clientInteractArtistRepository.createQueryBuilder,
      ).toHaveBeenCalledWith('clientInteractArtist');
      expect(getArtistDetailService.getArtistDetails).toHaveBeenCalledWith(
        'client-1',
        'artist-1',
      );
      expect(result).toEqual([mockArtistDetail]);
    });

    it('should return empty list when no artist interactions exist (Empty State)', async () => {
      // Given (Arrange)
      clientInteractArtistRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([]);

      // When (Act)
      const result = await service.getArtists('client-1', 0, 10);

      // Then (Assert)
      expect(result).toEqual([]);
      expect(getArtistDetailService.getArtistDetails).not.toHaveBeenCalled();
    });

    it('should propagate errors when dependency rejects (Sad Path)', async () => {
      // Given (Arrange)
      clientInteractArtistRepository
        .createQueryBuilder()
        .getMany.mockRejectedValueOnce(new Error('Database error'));

      // When & Then (Act & Assert)
      await expect(service.getArtists('client-1', 0, 10)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('getTattoos', () => {
    it('should execute getTattoos successfully and return minimal tattoo details (Happy Path)', async () => {
      // Given (Arrange)
      const mockPhotos = [
        {
          id: 'tattoo-inter-1',
          tattoo: { id: 'tattoo-1', title: 'Tattoo 1' },
        },
      ];
      const mockTattooMinimal = {
        id: 'tattoo-1',
        title: 'Tattoo 1',
        photoUrl: 'http://img.png',
      };

      clientInteractTattooRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce(mockPhotos as any);
      getTattooMinimalService.getMinimal.mockResolvedValueOnce(
        mockTattooMinimal as any,
      );

      // When (Act)
      const result = await service.getTattoos('client-1', 0, 10);

      // Then (Assert)
      expect(
        clientInteractTattooRepository.createQueryBuilder,
      ).toHaveBeenCalledWith('clientInteractPhoto');
      expect(getTattooMinimalService.getMinimal).toHaveBeenCalledWith(
        'client-1',
        mockPhotos[0].tattoo,
        5,
      );
      expect(result).toEqual([mockTattooMinimal]);
    });

    it('should return empty list when no tattoo interactions exist (Empty State)', async () => {
      // Given (Arrange)
      clientInteractTattooRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([]);

      // When (Act)
      const result = await service.getTattoos('client-1', 0, 10);

      // Then (Assert)
      expect(result).toEqual([]);
      expect(getTattooMinimalService.getMinimal).not.toHaveBeenCalled();
    });

    it('should propagate errors when getTattooMinimalService fails (Sad Path)', async () => {
      // Given (Arrange)
      const mockPhotos = [{ tattoo: { id: 'tattoo-1' } }];
      clientInteractTattooRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce(mockPhotos as any);
      getTattooMinimalService.getMinimal.mockRejectedValueOnce(
        new Error('Service failed'),
      );

      // When & Then (Act & Assert)
      await expect(service.getTattoos('client-1', 0, 10)).rejects.toThrow(
        'Service failed',
      );
    });
  });

  describe('getHashtags', () => {
    it('should execute getHashtags successfully and return hashtag search details (Happy Path)', async () => {
      // Given (Arrange)
      const mockHashtags = [
        {
          id: 'hashtag-inter-1',
          hashtag: { id: 'hashtag-1', name: '#ink' },
        },
      ];
      const mockHashtagDetail = {
        hashtag: { id: 'hashtag-1', name: '#ink' },
        qtTattoos: 10,
        userLikes: true,
      };

      clientInteractHashtagRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce(mockHashtags as any);
      getHashtagDetailService.getHashtagSearchDetail.mockResolvedValueOnce(
        mockHashtagDetail as any,
      );

      // When (Act)
      const result = await service.getHashtags('client-1', 0, 10);

      // Then (Assert)
      expect(
        clientInteractHashtagRepository.createQueryBuilder,
      ).toHaveBeenCalledWith('clientInteractHashtag');
      expect(
        getHashtagDetailService.getHashtagSearchDetail,
      ).toHaveBeenCalledWith(mockHashtags[0].hashtag, 'client-1');
      expect(result).toEqual([mockHashtagDetail]);
    });

    it('should return empty list when no hashtag interactions exist (Empty State)', async () => {
      // Given (Arrange)
      clientInteractHashtagRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([]);

      // When (Act)
      const result = await service.getHashtags('client-1', 0, 10);

      // Then (Assert)
      expect(result).toEqual([]);
      expect(
        getHashtagDetailService.getHashtagSearchDetail,
      ).not.toHaveBeenCalled();
    });

    it('should propagate errors when repository execution fails (Sad Path)', async () => {
      // Given (Arrange)
      clientInteractHashtagRepository
        .createQueryBuilder()
        .getMany.mockRejectedValueOnce(new Error('Hashtag Query Error'));

      // When & Then (Act & Assert)
      await expect(service.getHashtags('client-1', 0, 10)).rejects.toThrow(
        'Hashtag Query Error',
      );
    });
  });
});
