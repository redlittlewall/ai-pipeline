import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetHashtagByNameService } from './GetHashtagByName.Service';
import { Hashtag } from 'model/hashtag/Hashtag.entity';
import { ApprovalStatus } from 'enums/ApprovalStatus';

describe('GetHashtagByNameService', () => {
  let service: GetHashtagByNameService;
  let hashtagRepository: any;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetHashtagByNameService,
        {
          provide: getRepositoryToken(Hashtag),
          useValue: hashtagRepository,
        },
      ],
    }).compile();

    service = module.get<GetHashtagByNameService>(GetHashtagByNameService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('get', () => {
    it('should execute get successfully (happy path)', async () => {
      // Arrange
      const mockHashtag = { id: '123', name: 'test-hashtag' } as any;
      hashtagRepository.findOne.mockResolvedValueOnce(mockHashtag);

      // Act
      const result = await service.get('test-hashtag' as any);

      // Assert
      expect(hashtagRepository.findOne).toHaveBeenCalledWith({
        where: { status: ApprovalStatus.APPROVED, name: 'test-hashtag' },
      });
      expect(result).toEqual({ id: '123', name: 'test-hashtag' });
    });

    it('should throw when repository returns null (entity not found)', async () => {
      // Arrange
      hashtagRepository.findOne.mockResolvedValueOnce(null);

      // Act & Assert
      await expect(service.get('nonexistent' as any)).rejects.toThrow();
      expect(hashtagRepository.findOne).toHaveBeenCalledWith({
        where: { status: ApprovalStatus.APPROVED, name: 'nonexistent' },
      });
    });

    it('should propagate repository errors (sad path)', async () => {
      // Arrange
      const error = new Error('Database unavailable');
      hashtagRepository.findOne.mockRejectedValueOnce(error);

      // Act & Assert
      await expect(service.get('any' as any)).rejects.toThrow(
        'Database unavailable',
      );
      expect(hashtagRepository.findOne).toHaveBeenCalledWith({
        where: { status: ApprovalStatus.APPROVED, name: 'any' },
      });
    });
  });
});
