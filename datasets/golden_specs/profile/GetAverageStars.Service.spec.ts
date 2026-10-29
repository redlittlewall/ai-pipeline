import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetAverageStarsService } from './GetAverageStars.Service';
import { ReviewBudget } from 'model/budget/ReviewBudget.entity';

describe('GetAverageStarsService', () => {
  let service: GetAverageStarsService;
  let reviewBudgetRepository: any;

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
    reviewBudgetRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetAverageStarsService,
        {
          provide: getRepositoryToken(ReviewBudget),
          useValue: reviewBudgetRepository,
        },
      ],
    }).compile();

    service = module.get<GetAverageStarsService>(GetAverageStarsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('call', () => {
    it('should return the average stars when reviews exist', async () => {
      // Arrange
      const mockReviews = [
        { stars: 4 } as any,
        { stars: 5 } as any,
        { stars: 3 } as any,
      ];
      reviewBudgetRepository.find.mockResolvedValueOnce(mockReviews as any);

      // Act
      const result = await service.call('artist-id' as any);

      // Assert
      const expectedAverage = (4 + 5 + 3) / mockReviews.length;
      expect(result).toBeCloseTo(expectedAverage);
      expect(reviewBudgetRepository.find).toHaveBeenCalledWith({
        relations: ['budget', 'budget.selectedArtist'],
        where: {
          budget: {
            selectedArtist: {
              id: 'artist-id',
            },
          },
        },
      });
    });

    it('should return null when no reviews are found', async () => {
      // Arrange
      reviewBudgetRepository.find.mockResolvedValueOnce([] as any);

      // Act
      const result = await service.call('artist-id' as any);

      // Assert
      expect(result).toBeNull();
      expect(reviewBudgetRepository.find).toHaveBeenCalled();
    });

    it('should return null and log an error when the repository throws', async () => {
      // Arrange
      const error = new Error('Database unavailable');
      reviewBudgetRepository.find.mockRejectedValueOnce(error);
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Act
      const result = await service.call('artist-id' as any);

      // Assert
      expect(result).toBeNull();
      expect(reviewBudgetRepository.find).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Erro ao calcular média de avaliações para o artista artist-id:`,
        error,
      );

      // Cleanup
      consoleErrorSpy.mockRestore();
    });
  });
});
