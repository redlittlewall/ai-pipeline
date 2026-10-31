import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SearchPhotosService } from './SearchPhotos.service';
import { TattooEntity } from 'model/tattoo/Tattoo.entity';
import { GetTattooMinimalService } from 'modules/tattoo/GetTattooMinimal.Service';
import { LocateQueryService } from 'modules/address/LocateQuery.Service';

describe('SearchPhotosService', () => {
  let service: SearchPhotosService;
  let tattooEntityRepository: any;
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
    tattooEntityRepository = createMockRepository();
    getTattooMinimalService = {
      getMinimal: jest.fn(),
    };
    locateQueryService = {
      call: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchPhotosService,
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooEntityRepository,
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

    service = module.get<SearchPhotosService>(SearchPhotosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('search', () => {
    it('should execute search successfully with minimal parameters', async () => {
      // Arrange
      const mockTattoos = [{ id: '1' }] as any;
      tattooEntityRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce(mockTattoos);
      getTattooMinimalService.getMinimal.mockResolvedValue({ id: '1' } as any);

      // Act
      const result = await service.search('user-1', '', {} as any, 0, 10);

      // Assert
      expect(result).toHaveLength(1);
      expect(
        tattooEntityRepository.createQueryBuilder().getMany,
      ).toHaveBeenCalled();
      expect(getTattooMinimalService.getMinimal).toHaveBeenCalled();
    });

    it('should apply all filters when provided', async () => {
      // Arrange
      const filters = {
        colors: [{ id: 'c1' }],
        styles: [{ id: 's1' }],
        bodyParts: [{ id: 'b1' }],
        sizes: [{ id: 'sz1' }],
      } as any;
      tattooEntityRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([]);

      // Act
      await service.search('user-1', '', filters, 0, 10);

      // Assert
      expect(
        tattooEntityRepository.createQueryBuilder().leftJoin,
      ).toHaveBeenCalledWith('details.colors', 'colors');
      expect(
        tattooEntityRepository.createQueryBuilder().leftJoin,
      ).toHaveBeenCalledWith('details.styles', 'styles');
      expect(
        tattooEntityRepository.createQueryBuilder().leftJoin,
      ).toHaveBeenCalledWith('details.bodyPart', 'bodyPart');
      expect(
        tattooEntityRepository.createQueryBuilder().leftJoin,
      ).toHaveBeenCalledWith('details.size', 'size');
      expect(
        tattooEntityRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith(
        expect.stringContaining('bodyPart.id IN'),
        expect.anything(),
      );
    });

    it('should apply location filters (city and state)', async () => {
      // Arrange
      const filters = {
        location: { cityId: 'city1', stateId: 'state1' },
      } as any;
      tattooEntityRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([]);

      // Act
      await service.search('user-1', '', filters, 0, 10);

      // Assert
      expect(
        tattooEntityRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith('spots.city = :cityId', { cityId: 'city1' });
      expect(
        tattooEntityRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith('spots.state = :stateId', { stateId: 'state1' });
    });

    it('should call locateQueryService when onlyNearMe is true', async () => {
      // Arrange
      const filters = {
        location: { onlyNearMe: true },
      } as any;
      tattooEntityRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([]);

      // Act
      await service.search('user-1', '', filters, 0, 10);

      // Assert
      expect(locateQueryService.call).toHaveBeenCalled();
    });

    it('should apply search field filters', async () => {
      // Arrange
      tattooEntityRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([]);

      // Act
      await service.search('user-1', 'tattoo-desc', {} as any, 0, 10);

      // Assert
      expect(
        tattooEntityRepository.createQueryBuilder().leftJoin,
      ).toHaveBeenCalledWith(
        'details.detailsHasHashtags',
        'detailsHasHashtags',
      );
      expect(
        tattooEntityRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith(
        expect.stringContaining('unaccent'),
        expect.anything(),
      );
    });

    it('should return empty array when no results found', async () => {
      // Arrange
      tattooEntityRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([]);

      // Act
      const result = await service.search('user-1', '', {} as any, 0, 10);

      // Assert
      expect(result).toEqual([]);
    });

    it('should propagate errors from repository', async () => {
      // Arrange
      tattooEntityRepository
        .createQueryBuilder()
        .getMany.mockRejectedValueOnce(new Error('DB Error'));

      // Act & Assert
      await expect(
        service.search('user-1', '', {} as any, 0, 10),
      ).rejects.toThrow('DB Error');
    });
  });
});
