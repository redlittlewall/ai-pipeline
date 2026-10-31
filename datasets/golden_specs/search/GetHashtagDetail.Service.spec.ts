import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetHashtagDetailService } from './GetHashtagDetail.Service';
import { TattooDetailsHasHashtag } from 'model/hashtag/TattooHasHashtag.entity';
import { ClientInteractHashtag } from 'model/hashtag/ClientInteractHashtag.entity';
import { GetTattooMinimalService } from 'modules/tattoo/GetTattooMinimal.Service';
import { LocateQueryService } from 'modules/address/LocateQuery.Service';

describe('GetHashtagDetailService', () => {
  let service: GetHashtagDetailService;
  let tattooHasHashtagRepository: any;
  let clientInteractHashtagRepository: any;
  let getTattooMinimalService: any;
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
    tattooHasHashtagRepository = createMockRepository();
    clientInteractHashtagRepository = createMockRepository();
    getTattooMinimalService = {
      getMinimal: jest.fn(),
    };
    locateQueryService = {
      call: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetHashtagDetailService,
        {
          provide: getRepositoryToken(TattooDetailsHasHashtag),
          useValue: tattooHasHashtagRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractHashtag),
          useValue: clientInteractHashtagRepository,
        },
        {
          provide: GetTattooMinimalService,
          useValue: getTattooMinimalService,
        },
        {
          provide: LocateQueryService,
          useValue: locateQueryService,
        },
      ],
    }).compile();

    service = module.get<GetHashtagDetailService>(GetHashtagDetailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getHashtagSearchDetail', () => {
    const mockHashtag = {
      id: 'tag-1',
      name: 'tattoo',
      status: 'approved',
    } as any;
    const userId = 'user-123';

    it('should return hashtag details without filters (Happy Path)', async () => {
      // Given
      tattooHasHashtagRepository
        .createQueryBuilder()
        .getCount.mockResolvedValueOnce(10);
      tattooHasHashtagRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([
          { tattooDetails: { tattoo: { id: 't1' } } },
        ] as any);
      clientInteractHashtagRepository
        .createQueryBuilder()
        .getCount.mockResolvedValueOnce(1);
      getTattooMinimalService.getMinimal.mockResolvedValue({ id: 't1' } as any);

      // When
      const result = await service.getHashtagSearchDetail(mockHashtag, userId);

      // Then
      expect(result.qtTattoos).toBe(10);
      expect(result.userLikes).toBe(true);
      expect(result.hashtag.name).toBe('tattoo');
      expect(tattooHasHashtagRepository.createQueryBuilder).toHaveBeenCalled();
    });

    it('should apply location filter with onlyNearMe', async () => {
      // Given
      const filters = { location: { onlyNearMe: true } } as any;

      // When
      await service.getHashtagSearchDetail(mockHashtag, userId, filters);

      // Then
      expect(locateQueryService.call).toHaveBeenCalled();
    });

    it('should apply city and state filters when provided', async () => {
      // Given
      const filters = {
        location: { cityId: 'city-1', stateId: 'state-1' },
      } as any;

      // When
      await service.getHashtagSearchDetail(mockHashtag, userId, filters);

      // Then
      expect(
        tattooHasHashtagRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith(
        'spots.city = :cityId',
        expect.objectContaining({ cityId: 'city-1' }),
      );
      expect(
        tattooHasHashtagRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith(
        'spots.state = :stateId',
        expect.objectContaining({ stateId: 'state-1' }),
      );
    });

    it('should apply only state filter when city is missing', async () => {
      // Given
      const filters = {
        location: { stateId: 'state-1' },
      } as any;

      // When
      await service.getHashtagSearchDetail(mockHashtag, userId, filters);

      // Then
      expect(
        tattooHasHashtagRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith('spots.state = :stateId', { stateId: 'state-1' });
      expect(
        tattooHasHashtagRepository.createQueryBuilder().andWhere,
      ).not.toHaveBeenCalledWith('spots.city = :cityId', expect.any(Object));
    });

    it('should return userLikes as false when repository returns 0 counts', async () => {
      // Given
      clientInteractHashtagRepository
        .createQueryBuilder()
        .getCount.mockResolvedValueOnce(0);

      // When
      const result = await service.getHashtagSearchDetail(mockHashtag, userId);

      // Then
      expect(result.userLikes).toBe(false);
    });

    it('should propagate errors when the repository fails', async () => {
      // Given
      tattooHasHashtagRepository
        .createQueryBuilder()
        .getCount.mockRejectedValueOnce(new Error('DB Error'));

      // When & Then
      await expect(
        service.getHashtagSearchDetail(mockHashtag, userId),
      ).rejects.toThrow('DB Error');
    });
  });
});
