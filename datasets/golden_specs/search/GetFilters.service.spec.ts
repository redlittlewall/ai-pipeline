import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetFiltersService } from './GetFilters.service';
import { Artist } from 'model/users/Artist.entity';
import { GetArtistDetailService } from './GetArtistDetail.Service';
import { SponsorSearchAddService } from './SponsorSearchAdd.Service';
import { LocateQueryService } from 'modules/address/LocateQuery.Service';

describe('GetFiltersService', () => {
  let service: GetFiltersService;
  let artistRepository: any;
  let getArtistDetailService: any;
  let sponsorSearchAddService: any;
  let locateQueryService: any;

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
    getArtistDetailService = {
      getArtistDetails: jest.fn(),
    };
    sponsorSearchAddService = {
      getSponsors: jest.fn(),
    };
    locateQueryService = {
      call: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetFiltersService,
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: GetArtistDetailService,
          useValue: getArtistDetailService,
        },
        {
          provide: SponsorSearchAddService,
          useValue: sponsorSearchAddService,
        },
        {
          provide: LocateQueryService,
          useValue: locateQueryService,
        },
      ],
    }).compile();

    service = module.get<GetFiltersService>(GetFiltersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('search', () => {
    it('should apply name filter when name is provided', async () => {
      // Given
      const name = 'Tattoo';
      artistRepository.createQueryBuilder().getMany.mockResolvedValueOnce([]);

      // When
      await service.search('client-1', name, 0, 10);

      // Then
      expect(
        artistRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith(
        expect.stringContaining('unaccent(LOWER(client.username))'),
        { name: `${name}%` },
      );
    });

    it('should remove artist from results if they are already in sponsors list (deduplication)', async () => {
      // Given
      const mockArtist = {
        id: 'common-id',
        address: [{ id: 'addr-1' }] as any,
      } as any;
      const mockSponsor = { artist: { id: 'common-id' } } as any;
      const mockArtistDetail = { artist: { id: 'common-id' } } as any;

      artistRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([mockArtist]);

      getArtistDetailService.getArtistDetails.mockImplementation(
        (clientId: string, artistId: string) => {
          if (artistId === 'common-id')
            return Promise.resolve(mockArtistDetail);
          return Promise.resolve(null);
        },
      );

      sponsorSearchAddService.getSponsors.mockResolvedValueOnce([mockSponsor]);

      // When
      const result = await service.search('client-1', '', 0, 10);

      // Then
      // Result should have only the sponsor (deduplicated)
      expect(result).toHaveLength(1);
      expect(result[0].artist.id).toBe('common-id');
    });

    it('should skip sponsors and details if page > 0', async () => {
      // Given
      artistRepository.createQueryBuilder().getMany.mockResolvedValueOnce([]);

      // When
      await service.search('client-1', '', 1, 10);

      // Then
      expect(sponsorSearchAddService.getSponsors).not.toHaveBeenCalled();
    });

    it('should only fetch details for artists that have addresses', async () => {
      // Given
      const artistWithAddress = {
        id: '1',
        address: [{ id: 'a1' }] as any,
      } as any;
      const artistWithoutAddress = { id: '2', address: [] as any } as any;
      artistRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([
          artistWithAddress,
          artistWithoutAddress,
        ]);

      // When
      await service.search('client-1', 'name', 0, 10);

      // Then
      expect(getArtistDetailService.getArtistDetails).toHaveBeenCalledTimes(1);
      expect(getArtistDetailService.getArtistDetails).toHaveBeenCalledWith(
        'client-1',
        '1',
      );
    });

    it('should propagate errors if the repository fails', async () => {
      // Given
      artistRepository
        .createQueryBuilder()
        .getMany.mockRejectedValueOnce(new Error('DB Error'));

      // When & Then
      await expect(service.search('c', 'n', 0, 10)).rejects.toThrow('DB Error');
    });
  });
});
