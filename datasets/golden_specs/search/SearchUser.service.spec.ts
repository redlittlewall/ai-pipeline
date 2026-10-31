import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SearchArtistsService } from './SearchUser.service';
import { Artist } from 'model/users/Artist.entity';
import { Client } from 'pg';
import { TattooEntity } from 'model/tattoo/Tattoo.entity';
import { GetArtistDetailService } from './GetArtistDetail.Service';
import { TattooService } from 'modules/tattoo/Tattoo.service';
import { LocateQueryService } from 'modules/address/LocateQuery.Service';

describe('SearchArtistsService', () => {
  let service: SearchArtistsService;
  let artistRepository: any;
  let clientRepository: any;
  let tattooRepository: any;
  let getArtistDetailService: any;
  let tattooService: any;
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
    clientRepository = createMockRepository();
    tattooRepository = createMockRepository();
    getArtistDetailService = {
      getArtistDetails: jest.fn(),
    };
    tattooService = {
      getMinimalTattoo: jest.fn(),
    };
    locateQueryService = {
      call: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchArtistsService,
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooRepository,
        },
        {
          provide: GetArtistDetailService,
          useValue: getArtistDetailService,
        },
        {
          provide: TattooService,
          useValue: tattooService,
        },
        {
          provide: LocateQueryService,
          useValue: locateQueryService,
        },
      ],
    }).compile();

    service = module.get<SearchArtistsService>(SearchArtistsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('searchClient', () => {
    it('should execute searchClient successfully', async () => {
      // Given (Arrange)
      // Configure injected repository/service mocks if needed

      // When (Act)
      const result = await service.searchClient(
        'test-id' as any,
        'test-val' as any,
        1 as any,
        1 as any,
      );

      // Then (Assert)
      expect(result).toBeDefined();
    });
  });

  describe('searchArtist', () => {
    it('should execute searchArtist successfully', async () => {
      // Given (Arrange)
      // Configure injected repository/service mocks if needed

      // When (Act)
      const result = await service.searchArtist(
        'test-id' as any,
        'test-val' as any,
        1 as any,
        1 as any,
        { points: [{ y: 10 }] } as any,
      );

      // Then (Assert)
      expect(result).toBeDefined();
    });
  });
});
