import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SearchHashtagMentionService } from './SearchHashtagMention.Service';
import { Hashtag } from 'model/hashtag/Hashtag.entity';
import { GetHashtagMentionExtraDataByHashtagService } from './GetHashtagMentionExtraDataByHashtag.Service';
import { ApprovalStatus } from 'enums/ApprovalStatus';

describe('SearchHashtagMentionService', () => {
  let service: SearchHashtagMentionService;
  let hashtagRepository: any;
  let getHashtagMentionExtraDataByHashtagService: any;

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
    hashtagRepository = createMockRepository();
    getHashtagMentionExtraDataByHashtagService = {
      call: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchHashtagMentionService,
        {
          provide: getRepositoryToken(Hashtag),
          useValue: hashtagRepository,
        },
        {
          provide: GetHashtagMentionExtraDataByHashtagService,
          useValue: getHashtagMentionExtraDataByHashtagService,
        },
      ],
    }).compile();

    service = module.get<SearchHashtagMentionService>(
      SearchHashtagMentionService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('call', () => {
    beforeEach(() => {
      process.env.MENTION_SUGESTION_SIZE = '10';
    });

    it('should return sorted hashtags when inputs are valid', async () => {
      // Given
      const mockHashtags = [
        { id: '1', name: 'tag1' },
        { id: '2', name: 'tag2' },
      ] as any;

      hashtagRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce(mockHashtags);

      getHashtagMentionExtraDataByHashtagService.call
        .mockResolvedValueOnce({ qtTattoos: 10, display: 'tag1' } as any)
        .mockResolvedValueOnce({ qtTattoos: 20, display: 'tag2' } as any);

      // When
      const result = await service.call('user-id', 'search');

      // Then
      expect(result).toHaveLength(2);
      expect(result[0].qtTattoos).toBe(20); // Should be sorted descending
      expect(result[1].qtTattoos).toBe(10);
      expect(hashtagRepository.createQueryBuilder().where).toHaveBeenCalledWith(
        expect.stringContaining('unaccent'),
        expect.any(Object),
      );
      expect(
        hashtagRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith('hashtag.status = :status', {
        status: ApprovalStatus.APPROVED,
      });
    });

    it('should return empty array when no hashtags found', async () => {
      // Given
      hashtagRepository.createQueryBuilder().getMany.mockResolvedValueOnce([]);

      // When
      const result = await service.call('user-id', 'search');

      // Then
      expect(result).toEqual([]);
      expect(
        getHashtagMentionExtraDataByHashtagService.call,
      ).not.toHaveBeenCalled();
    });

    it('should propagate errors when dependency fails', async () => {
      // Given
      hashtagRepository
        .createQueryBuilder()
        .getMany.mockRejectedValueOnce(new Error('DB Error'));

      // When & Then
      await expect(service.call('user-id', 'search')).rejects.toThrow(
        'DB Error',
      );
    });
  });
});
