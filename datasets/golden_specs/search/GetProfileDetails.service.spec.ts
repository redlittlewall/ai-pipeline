import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetProfileDetailsService } from './GetProfileDetails.service';
import { TattooDetails } from 'model/tattoo/TattooDetails.Entity';
import { TattooEntity } from 'model/tattoo/Tattoo.entity';
import { Client } from 'model/users/Client.entity';
import { Artist } from 'model/users/Artist.entity';
import { Avatar } from 'model/Avatar.entity';
import { ClientInteractTattoo } from 'model/users/relations/ClientInteractTattoo.entity';
import { TattooHashtagsService } from '../tattoo/hashtag/TattooHashtag.service';
import { GetTattooStatisticsService } from '../tattoo/GetTattooStatistics.Service';
import { GetStyleService } from '../tattoo/style/GetStyles.service';
import { AvatarService } from 'modules/avatar/AvatarService';
import { TattooService } from 'modules/tattoo/Tattoo.service';

describe('GetProfileDetailsService', () => {
  let service: GetProfileDetailsService;
  let tattooDetailsRepository: any;
  let tattooEntityRepository: any;
  let clientRepository: any;
  let artistRepository: any;
  let avatarRepository: any;
  let clientInteractTattooRepository: any;
  let tattooHashtagService: any;
  let getPhotoStatisticsService: any;
  let getStyleService: any;
  let avatarService: any;
  let findTattooService: any;

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
    tattooDetailsRepository = createMockRepository();
    tattooEntityRepository = createMockRepository();
    clientRepository = createMockRepository();
    artistRepository = createMockRepository();
    avatarRepository = createMockRepository();
    clientInteractTattooRepository = createMockRepository();
    tattooHashtagService = {};
    getPhotoStatisticsService = {};
    getStyleService = {};
    avatarService = {};
    findTattooService = {
      tattooEntityToDTO: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetProfileDetailsService,
        {
          provide: getRepositoryToken(TattooDetails),
          useValue: tattooDetailsRepository,
        },
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooEntityRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: getRepositoryToken(Avatar),
          useValue: avatarRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractTattoo),
          useValue: clientInteractTattooRepository,
        },
        {
          provide: TattooHashtagsService,
          useValue: tattooHashtagService,
        },
        {
          provide: GetTattooStatisticsService,
          useValue: getPhotoStatisticsService,
        },
        {
          provide: GetStyleService,
          useValue: getStyleService,
        },
        {
          provide: AvatarService,
          useValue: avatarService,
        },
        {
          provide: TattooService,
          useValue: findTattooService,
        },
      ],
    }).compile();

    service = module.get<GetProfileDetailsService>(GetProfileDetailsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDetailsFromProfile', () => {
    it('should return empty lists when client is not found', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockResolvedValueOnce(null);

      // When (Act)
      const result = await service.getDetailsFromProfile(
        'viewer-1',
        'invalid-username',
      );

      // Then (Assert)
      expect(result.ownTattoos).toEqual([]);
      expect(result.markedTattoos).toEqual([]);
      expect(clientRepository.findOne).toHaveBeenCalled();
    });

    it('should return paginated tattoos when page and pageSize are provided', async () => {
      // Given (Arrange)
      const mockClient = { id: 'client-123', username: 'user1' } as any;
      const mockTattoo = { id: 't-1' } as any;
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      tattooEntityRepository.find.mockResolvedValue([mockTattoo] as any);
      findTattooService.tattooEntityToDTO.mockResolvedValue({
        id: 'dto-1',
      } as any);

      // When (Act)
      const result = await service.getDetailsFromProfile(
        'viewer-1',
        'user1',
        1,
        10,
      );

      // Then (Assert)
      expect(tattooEntityRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
      expect(result.ownTattoos).toHaveLength(1);
      expect(result.markedTattoos).toHaveLength(1);
    });

    it('should return all tattoos without pagination when params are null', async () => {
      // Given (Arrange)
      const mockClient = { id: 'client-123' } as any;
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      tattooEntityRepository.find.mockResolvedValueOnce([{ id: 'own' }] as any); // ownTattoos
      tattooEntityRepository.find.mockResolvedValueOnce([
        { id: 'marked' },
      ] as any); // markedTattoos
      findTattooService.tattooEntityToDTO.mockImplementation((v: any, e: any) =>
        Promise.resolve({ id: e.id }),
      );

      // When (Act)
      const result = await service.getDetailsFromProfile(
        'viewer-1',
        'client-123',
        null,
        null,
      );

      // Then (Assert)
      expect(tattooEntityRepository.find).not.toHaveBeenCalledWith(
        expect.objectContaining({
          skip: expect.any(Number),
        }),
      );
      expect(result.ownTattoos[0].id).toBe('own');
      expect(result.markedTattoos[0].id).toBe('marked');
    });

    it('should propagate errors when repository fails', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockRejectedValueOnce(new Error('DB Error'));

      // When & Then (Act & Assert)
      await expect(service.getDetailsFromProfile('v1', 'u1')).rejects.toThrow(
        'DB Error',
      );
    });
  });
});
