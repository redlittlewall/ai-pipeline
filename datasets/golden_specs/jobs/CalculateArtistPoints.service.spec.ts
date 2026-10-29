import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CalculateArtistPointsService } from './CalculateArtistPoints.service';
import { ClientInteractArtist } from 'model/users/relations/ClientInteractArtist.entity';
import { ApprovalStatus } from 'enums/ApprovalStatus';
import { ClientInteractionEnum } from 'enums/ClientInteractionEnum';

describe('CalculateArtistPointsService', () => {
  let service: CalculateArtistPointsService;
  let clientInteractArtistRepository: any;

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
    clientInteractArtistRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalculateArtistPointsService,
        {
          provide: getRepositoryToken(ClientInteractArtist),
          useValue: clientInteractArtistRepository,
        },
      ],
    }).compile();

    service = module.get<CalculateArtistPointsService>(
      CalculateArtistPointsService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('call', () => {
    it('should calculate points correctly when interactions are found', async () => {
      // Arrange
      const mockArtist = { id: 'artist-123' } as any;
      const action = ClientInteractionEnum.LIKE;
      const pointsPerAction = 10;
      const count = 5;

      clientInteractArtistRepository
        .createQueryBuilder()
        .getCount.mockResolvedValueOnce(count);

      // Act
      const result = await service.call(mockArtist, action, pointsPerAction);

      // Assert
      expect(result).toBe(50);
      const qb = clientInteractArtistRepository.createQueryBuilder();
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'interaction.artist',
        'artist',
      );
      expect(qb.where).toHaveBeenCalledWith('artist.id = :id', {
        id: 'artist-123',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('artist.status = :status', {
        status: ApprovalStatus.APPROVED,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'interaction.interactionType = :type',
        { type: ClientInteractionEnum.LIKE },
      );
      expect(qb.distinct).toHaveBeenCalledWith(true);
      expect(qb.getCount).toHaveBeenCalled();
    });

    it('should return 0 when no interactions match criteria', async () => {
      // Arrange
      const mockArtist = { id: 'artist-123' } as any;
      const action = ClientInteractionEnum.VIEW;
      const pointsPerAction = 5;

      clientInteractArtistRepository
        .createQueryBuilder()
        .getCount.mockResolvedValueOnce(0);

      // Act
      const result = await service.call(mockArtist, action, pointsPerAction);

      // Assert
      expect(result).toBe(0);
    });

    it('should return 0 when points multiplier is 0', async () => {
      // Arrange
      const mockArtist = { id: 'artist-123' } as any;
      const action = ClientInteractionEnum.SHARE;
      const pointsPerAction = 0;

      clientInteractArtistRepository
        .createQueryBuilder()
        .getCount.mockResolvedValueOnce(10);

      // Act
      const result = await service.call(mockArtist, action, pointsPerAction);

      // Assert
      expect(result).toBe(0);
    });

    it('should propagate error when repository throws exception', async () => {
      // Arrange
      const mockArtist = { id: 'artist-123' } as any;
      const action = ClientInteractionEnum.COMMENT;
      const pointsPerAction = 2;

      clientInteractArtistRepository
        .createQueryBuilder()
        .getCount.mockRejectedValueOnce(new Error('Database error'));

      // Act & Assert
      await expect(
        service.call(mockArtist, action, pointsPerAction),
      ).rejects.toThrow('Database error');
    });
  });
});
