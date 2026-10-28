import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QtPhotosInHashtagService } from './QtPhotosInHashtag.Service';
import { TattooDetailsHasHashtag } from 'model/hashtag/TattooHasHashtag.entity';

describe('QtPhotosInHashtagService', () => {
  let service: QtPhotosInHashtagService;
  let tattooHasHashtagRepository: any;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QtPhotosInHashtagService,
        {
          provide: getRepositoryToken(TattooDetailsHasHashtag),
          useValue: tattooHasHashtagRepository,
        },
      ],
    }).compile();

    service = module.get<QtPhotosInHashtagService>(QtPhotosInHashtagService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('call', () => {
    it('should return the count of photos for a given hashtag (Happy Path)', async () => {
      // Given (Arrange)
      const hashtagId = 'uuid-123';
      const expectedCount = 5;
      tattooHasHashtagRepository.count.mockResolvedValueOnce(expectedCount);

      // When (Act)
      const result = await service.call(hashtagId);

      // Then (Assert)
      expect(result).toBe(expectedCount);
      expect(tattooHasHashtagRepository.count).toHaveBeenCalledWith({
        where: {
          hashtag: { id: hashtagId },
        },
      });
    });

    it('should return 0 when no photos are associated with the hashtag (Empty State)', async () => {
      // Given (Arrange)
      tattooHasHashtagRepository.count.mockResolvedValueOnce(0);

      // When (Act)
      const result = await service.call('empty-hashtag');

      // Then (Assert)
      expect(result).toBe(0);
      expect(tattooHasHashtagRepository.count).toHaveBeenCalled();
    });

    it('should propagate errors when the repository fails (Sad Path)', async () => {
      // Given (Arrange)
      const dbError = new Error('Database connection failed');
      tattooHasHashtagRepository.count.mockRejectedValueOnce(dbError);

      // When & Then (Act & Assert)
      await expect(service.call('any-id')).rejects.toThrow(
        'Database connection failed',
      );
    });
  });
});
