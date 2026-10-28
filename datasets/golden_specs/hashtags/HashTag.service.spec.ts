import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HashTagService } from './HashTag.service';
import { Hashtag } from 'model/hashtag/Hashtag.entity';
import { Artist } from 'model/users/Artist.entity';
import { NormalizeHashtagService } from './NormalizeHashtag.Service';

describe('HashTagService', () => {
  let service: HashTagService;
  let hashTagRepository: any;
  let artistRepository: any;
  let normalizeHashtagService: any;

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
    hashTagRepository = createMockRepository();
    artistRepository = createMockRepository();
    normalizeHashtagService = {
      normalize: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HashTagService,
        {
          provide: getRepositoryToken(Hashtag),
          useValue: hashTagRepository,
        },
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: NormalizeHashtagService,
          useValue: normalizeHashtagService,
        },
      ],
    }).compile();

    service = module.get<HashTagService>(HashTagService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAllTags', () => {
    it('should execute getAllTags successfully', async () => {
      // Given (Arrange)
      // Configure injected repository/service mocks if needed

      // When (Act)
      const result = await service.getAllTags(
        'test-val' as any,
        'test-val' as any,
        1 as any,
        1 as any,
      );

      // Then (Assert)
      expect(result).toBeDefined();
    });
  });

  describe('createOrRecoverTag', () => {
    it('should execute createOrRecoverTag successfully', async () => {
      // Given (Arrange)
      // Configure injected repository/service mocks if needed

      // When (Act)
      const result = await service.createOrRecoverTag(
        'test-val' as any,
        true as any,
        true as any,
      );

      // Then (Assert)
      expect(result).toBeDefined();
    });
  });
});
