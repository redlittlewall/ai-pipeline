import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CalculateCommentPointsService } from './CalculateCommentPoints.service';
import { Comment } from 'model/comments/Comment.entity';
import { ApprovalStatus } from 'enums/ApprovalStatus';

describe('CalculateCommentPointsService', () => {
  let service: CalculateCommentPointsService;
  let commentRepository: any;

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
    commentRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalculateCommentPointsService,
        {
          provide: getRepositoryToken(Comment),
          useValue: commentRepository,
        },
      ],
    }).compile();

    service = module.get<CalculateCommentPointsService>(
      CalculateCommentPointsService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('call', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('should calculate points correctly when comments exist (Happy Path)', async () => {
      // Given
      process.env.POINTS_PHOTO_COMMENT = '5';
      const qb = commentRepository.createQueryBuilder();
      qb.getCount.mockResolvedValueOnce(4);

      // When
      const result = await service.call('artist-123');

      // Then
      expect(result).toBe(20);
      expect(commentRepository.createQueryBuilder).toHaveBeenCalledWith(
        'comment',
      );
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'comment.photo',
        'photo',
      );
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'photo.artist',
        'artist',
      );
      expect(qb.select).toHaveBeenCalledWith('comment.client');
      expect(qb.where).toHaveBeenCalledWith('artist.id = :id', {
        id: 'artist-123',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('photo.status = :status', {
        status: ApprovalStatus.APPROVED,
      });
      expect(qb.distinct).toHaveBeenCalledWith(true);
      expect(qb.getCount).toHaveBeenCalled();
    });

    it('should return 0 when count is 0 (Empty State)', async () => {
      // Given
      process.env.POINTS_PHOTO_COMMENT = '10';
      const qb = commentRepository.createQueryBuilder();
      qb.getCount.mockResolvedValueOnce(0);

      // When
      const result = await service.call('artist-456');

      // Then
      expect(result).toBe(0);
      expect(qb.getCount).toHaveBeenCalled();
    });

    it('should handle zero multiplication points factor properly', async () => {
      // Given
      process.env.POINTS_PHOTO_COMMENT = '0';
      const qb = commentRepository.createQueryBuilder();
      qb.getCount.mockResolvedValueOnce(10);

      // When
      const result = await service.call('artist-789');

      // Then
      expect(result).toBe(0);
    });

    it('should propagate errors if database query fails (Sad Path)', async () => {
      // Given
      const qb = commentRepository.createQueryBuilder();
      qb.getCount.mockRejectedValueOnce(new Error('Database error'));

      // When & Then
      await expect(service.call('artist-123')).rejects.toThrow(
        'Database error',
      );
    });
  });
});
