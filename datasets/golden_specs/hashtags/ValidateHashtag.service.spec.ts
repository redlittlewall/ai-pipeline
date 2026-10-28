import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ValidateHashtagService } from './ValidateHashtag.service';
import { Hashtag } from 'model/hashtag/Hashtag.entity';

describe('ValidateHashtagService', () => {
  let service: ValidateHashtagService;
  let HashtagRepository: any;

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
    HashtagRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateHashtagService,
        {
          provide: getRepositoryToken(Hashtag),
          useValue: HashtagRepository,
        },
      ],
    }).compile();

    service = module.get<ValidateHashtagService>(ValidateHashtagService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validate', () => {
    it('should return the existing hashtag if found (case insensitive match)', async () => {
      // Given (Arrange)
      const existingHashtag = { id: '1', name: 'Nature' } as any;
      HashtagRepository.createQueryBuilder().getOne.mockResolvedValueOnce(
        existingHashtag,
      );

      // When (Act)
      const result = await service.validate({ name: 'nature' } as any);

      // Then (Assert)
      expect(HashtagRepository.createQueryBuilder).toHaveBeenCalled();
      expect(result.tagValid).toBe(true);
      expect(result.foundTag).toEqual(existingHashtag);
    });

    it('should return valid true when hashtag does not exist and name is valid', async () => {
      // Given (Arrange)
      HashtagRepository.createQueryBuilder().getOne.mockResolvedValueOnce(null);
      const newHashtagDto = { name: 'Valid-Tag_123' };

      // When (Act)
      const result = await service.validate(newHashtagDto as any);

      // Then (Assert)
      expect(result.tagValid).toBe(true);
      expect(result.foundTag).toEqual(newHashtagDto);
    });

    it('should return valid false when hashtag does not exist and name is too short', async () => {
      // Given (Arrange)
      HashtagRepository.createQueryBuilder().getOne.mockResolvedValueOnce(null);
      const invalidDto = { name: 'a' };

      // When (Act)
      const result = await service.validate(invalidDto as any);

      // Then (Assert)
      expect(result.tagValid).toBe(false);
      expect(result.foundTag).toBeNull();
    });

    it('should return valid false when hashtag does not exist and name contains invalid characters', async () => {
      // Given (Arrange)
      HashtagRepository.createQueryBuilder().getOne.mockResolvedValueOnce(null);
      const invalidDto = { name: 'Invalid#Tag' };

      // When (Act)
      const result = await service.validate(invalidDto as any);

      // Then (Assert)
      expect(result.tagValid).toBe(false);
      expect(result.foundTag).toBeNull();
    });

    it('should propagate errors when the database query fails', async () => {
      // Given (Arrange)
      HashtagRepository.createQueryBuilder().getOne.mockRejectedValueOnce(
        new Error('DB Error'),
      );

      // When & Then (Act & Assert)
      await expect(service.validate({ name: 'test' } as any)).rejects.toThrow(
        'DB Error',
      );
    });
  });
});
