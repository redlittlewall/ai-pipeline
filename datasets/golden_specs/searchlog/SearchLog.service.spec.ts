import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SearchLogService } from './SearchLog.service';
import { SearchLog } from 'model/SearchLog.entity';

describe('SearchLogService', () => {
  let service: SearchLogService;
  let searchLogRepository: any;

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
    searchLogRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchLogService,
        {
          provide: getRepositoryToken(SearchLog),
          useValue: searchLogRepository,
        },
      ],
    }).compile();

    service = module.get<SearchLogService>(SearchLogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('armazenarSearch', () => {
    it('should save and return search log when search is valid', async () => {
      // Given
      const mockSearchLog = { id: '123' } as any;
      searchLogRepository.save.mockResolvedValueOnce(mockSearchLog);

      // When
      const result = await service.armazenarSearch(
        {} as any,
        'valid search',
        1 as any,
        {} as any,
      );

      // Then
      expect(searchLogRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockSearchLog);
    });

    it('should return null when search is null', async () => {
      // When
      const result = await service.armazenarSearch(
        {} as any,
        null as any,
        1 as any,
        {} as any,
      );

      // Then
      expect(result).toBeNull();
      expect(searchLogRepository.save).not.toHaveBeenCalled();
    });

    it('should return null when search is an empty string', async () => {
      // When
      const result = await service.armazenarSearch(
        {} as any,
        '',
        1 as any,
        {} as any,
      );

      // Then
      expect(result).toBeNull();
      expect(searchLogRepository.save).not.toHaveBeenCalled();
    });

    it('should propagate errors when repository save fails', async () => {
      // Given
      searchLogRepository.save.mockRejectedValueOnce(
        new Error('Database error'),
      );

      // When & Then
      await expect(
        service.armazenarSearch({} as any, 'search', 1 as any, {} as any),
      ).rejects.toThrow('Database error');
    });
  });

  describe('updateSearchWithResults', () => {
    it('should update search results when searchLog is provided', async () => {
      // Given
      const mockSearchLog = { search_results: 0 } as any;

      // When
      await service.updateSearchWithResults(mockSearchLog, 10);

      // Then
      expect(mockSearchLog.search_results).toBe(10);
      expect(searchLogRepository.save).toHaveBeenCalledWith(mockSearchLog);
    });

    it('should do nothing when searchLog is null', async () => {
      // When
      await service.updateSearchWithResults(null as any, 10);

      // Then
      expect(searchLogRepository.save).not.toHaveBeenCalled();
    });

    it('should propagate errors when repository save fails', async () => {
      // Given
      const mockSearchLog = { search_results: 0 } as any;
      searchLogRepository.save.mockRejectedValueOnce(
        new Error('Database error'),
      );

      // When & Then
      await expect(
        service.updateSearchWithResults(mockSearchLog, 10),
      ).rejects.toThrow('Database error');
    });
  });
});
