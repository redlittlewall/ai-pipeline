import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SearchHashtagsService } from './SearchHashtags.service';
import { Hashtag } from 'model/hashtag/Hashtag.entity';
import { GetHashtagDetailService } from './GetHashtagDetail.Service';
import { LocateQueryService } from 'modules/address/LocateQuery.Service';

describe('SearchHashtagsService', () => {
  let service: SearchHashtagsService;
  let hashtagRepository: any;
  let getHashtagDetailService: any;
  let locateQueryService: any;
  let queryBuilderMock: any;

  beforeEach(async () => {
    const createQueryBuilderMock = () => {
      const qb: any = new Proxy(
        {},
        {
          get(target, prop) {
            if (prop === 'then') return undefined;
            if (!(prop in target)) {
              target[prop] = jest.fn().mockImplementation((...args: any[]) => {
                const callbackMethods = [
                  'where',
                  'andWhere',
                  'orWhere',
                  'having',
                  'orHaving',
                ];
                if (
                  callbackMethods.includes(prop as string) &&
                  args.length > 0 &&
                  typeof args[0] === 'function'
                ) {
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

    queryBuilderMock = createQueryBuilderMock();

    const createMockRepository = () => {
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
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilderMock),
      };
    };
    hashtagRepository = createMockRepository();
    getHashtagDetailService = {
      getHashtagSearchDetail: jest.fn(),
    };
    locateQueryService = {
      call: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchHashtagsService,
        {
          provide: getRepositoryToken(Hashtag),
          useValue: hashtagRepository,
        },
        {
          provide: GetHashtagDetailService,
          useValue: getHashtagDetailService,
        },
        {
          provide: LocateQueryService,
          useValue: locateQueryService,
        },
      ],
    }).compile();

    service = module.get<SearchHashtagsService>(SearchHashtagsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('search', () => {
    it('should execute search successfully and return results (Happy Path)', async () => {
      // Given (Arrange)
      const mockHashtag = { id: 'h1', name: 'tatuagem' } as any;
      const mockDetail = {
        hashtag: mockHashtag,
        tattoos: [{ id: 't1' }],
      } as any;

      hashtagRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([mockHashtag]);
      getHashtagDetailService.getHashtagSearchDetail.mockResolvedValueOnce(
        mockDetail,
      );

      // When (Act)
      const result = await service.search('user-1', '#tatuagem', 0, 10);

      // Then (Assert)
      expect(result).toHaveLength(1);
      expect(result[0].hashtag.id).toBe('h1');
      expect(hashtagRepository.createQueryBuilder).toHaveBeenCalled();
    });

    it('should apply location filters when cityId is provided', async () => {
      // Given
      const filters = {
        location: { cityId: 'city-123', stateId: 'state-456' },
      } as any;
      hashtagRepository.createQueryBuilder().getMany.mockResolvedValueOnce([]);

      // When
      await service.search('user-1', 'tag', 0, 10, filters);

      // Then
      expect(
        hashtagRepository.createQueryBuilder().leftJoin,
      ).toHaveBeenCalledWith('artist.address', 'address');
      expect(
        hashtagRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith(
        'spots.city = :cityId',
        expect.objectContaining({ cityId: 'city-123' }),
      );
      expect(
        hashtagRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith(
        'spots.state = :stateId',
        expect.objectContaining({ stateId: 'state-456' }),
      );
    });

    it('should call locateQueryService when onlyNearMe is true', async () => {
      // Given
      const filters = { location: { onlyNearMe: true } } as any;
      hashtagRepository.createQueryBuilder().getMany.mockResolvedValueOnce([]);

      // When
      await service.search('user-1', 'tag', 0, 10, filters);

      // Then
      expect(locateQueryService.call).toHaveBeenCalledWith(
        queryBuilderMock,
        'user-1',
      );
    });

    it('should filter out hashtags that return no tattoos from detail service', async () => {
      // Given
      const mockHashtags = [{ id: 'h1' }, { id: 'h2' }] as any;
      hashtagRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce(mockHashtags);

      // h1 returns tattoos, h2 does not
      getHashtagDetailService.getHashtagSearchDetail
        .mockResolvedValueOnce({ tattoos: [{ id: 't1' }] } as any)
        .mockResolvedValueOnce({ tattoos: [] } as any);

      // When
      const result = await service.search('user-1', '', 0, 10);

      // Then
      expect(result).toHaveLength(1);
    });

    it('should clean hashtag name by removing leading symbols', async () => {
      // Given
      hashtagRepository.createQueryBuilder().getMany.mockResolvedValueOnce([]);

      // When
      await service.search('user-1', '###cooltag', 0, 10);

      // Then
      expect(
        hashtagRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith(
        expect.stringContaining('hashtag.name'),
        expect.objectContaining({ name: '%cooltag%' }),
      );
    });

    it('should propagate errors when the database fails', async () => {
      // Given
      hashtagRepository
        .createQueryBuilder()
        .getMany.mockRejectedValueOnce(new Error('DB Error'));

      // When & Then
      await expect(service.search('user-1', 'tag', 0, 10)).rejects.toThrow(
        'DB Error',
      );
    });
  });
});
