import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClientHashTagService } from './ClientHashtag.service';
import { ClientInteractHashtag } from 'model/hashtag/ClientInteractHashtag.entity';
import { ClientInteractionEnum } from 'enums/ClientInteractionEnum';
import { HashTagMinimalDto } from 'model/dto/hashTag/HashTagMinimalDto';

describe('ClientHashTagService', () => {
  let service: ClientHashTagService;
  let clientInteractHashtagRepository: any;

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
    clientInteractHashtagRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientHashTagService,
        {
          provide: getRepositoryToken(ClientInteractHashtag),
          useValue: clientInteractHashtagRepository,
        },
      ],
    }).compile();

    service = module.get<ClientHashTagService>(ClientHashTagService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getClientTags', () => {
    it('should execute getClientTags successfully and return mapped HashTagMinimalDto list (Happy Path)', async () => {
      // Given (Arrange)
      const mockRawResults = [
        {
          hashtag_name: 'travel',
          hashtag_id: 'tag-1',
          hashtag_status: 'APPROVED',
        },
        {
          hashtag_name: 'photography',
          hashtag_id: 'tag-2',
          hashtag_status: 'PENDING',
        },
      ];
      const qb = clientInteractHashtagRepository.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce(mockRawResults as any);

      // When (Act)
      const result = await service.getClientTags('client-123');

      // Then (Assert)
      expect(
        clientInteractHashtagRepository.createQueryBuilder,
      ).toHaveBeenCalledWith('interaction');
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'interaction.hashtag',
        'hashtag',
      );
      expect(qb.where).toHaveBeenCalledWith(
        'interaction.interactionType = :type',
        {
          type: ClientInteractionEnum.LIKE,
        },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'interaction.client = :clientId',
        {
          clientId: 'client-123',
        },
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(HashTagMinimalDto);
      expect(result[0]).toEqual(
        new HashTagMinimalDto('travel', 'tag-1', 'APPROVED' as any),
      );
      expect(result[1]).toEqual(
        new HashTagMinimalDto('photography', 'tag-2', 'PENDING' as any),
      );
    });

    it('should return empty array when no hashtag interactions are found', async () => {
      // Given (Arrange)
      const qb = clientInteractHashtagRepository.createQueryBuilder();
      qb.getRawMany.mockResolvedValueOnce([]);

      // When (Act)
      const result = await service.getClientTags('client-no-tags');

      // Then (Assert)
      expect(result).toEqual([]);
      expect(qb.getRawMany).toHaveBeenCalled();
    });

    it('should propagate errors when query builder fails (Sad Path)', async () => {
      // Given (Arrange)
      const qb = clientInteractHashtagRepository.createQueryBuilder();
      qb.getRawMany.mockRejectedValueOnce(new Error('Database query failure'));

      // When & Then (Act & Assert)
      await expect(service.getClientTags('client-error')).rejects.toThrow(
        'Database query failure',
      );
    });
  });
});
