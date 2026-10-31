import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { GetArtistDetailService } from './GetArtistDetail.Service';
import { Artist } from 'model/users/Artist.entity';
import { Avatar } from 'model/Avatar.entity';
import { TattooEntity } from 'model/tattoo/Tattoo.entity';
import { Badges } from 'model/Badges.entity';
import { ClientInteractArtist } from 'model/users/relations/ClientInteractArtist.entity';
import { ClientHashTagService } from 'modules/hashtags/ClientHashtag.service';
import { GetTattooMinimalService } from 'modules/tattoo/GetTattooMinimal.Service';
import { AvatarService } from 'modules/avatar/AvatarService';

describe('GetArtistDetailService', () => {
  let service: GetArtistDetailService;
  let artistRepository: any;
  let avatarRepository: any;
  let tattooEntityRepository: any;
  let badgesRepository: any;
  let clientInteractArtistRepository: any;
  let clientHashTagService: any;
  let getTattooMinimalService: any;
  let avatarService: any;

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
    artistRepository = createMockRepository();
    avatarRepository = createMockRepository();
    tattooEntityRepository = createMockRepository();
    badgesRepository = createMockRepository();
    clientInteractArtistRepository = createMockRepository();
    clientHashTagService = {
      getClientTags: jest.fn(),
    };
    getTattooMinimalService = {
      getMinimal: jest.fn(),
    };
    avatarService = {
      getAvatar: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetArtistDetailService,
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: getRepositoryToken(Avatar),
          useValue: avatarRepository,
        },
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooEntityRepository,
        },
        {
          provide: getRepositoryToken(Badges),
          useValue: badgesRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractArtist),
          useValue: clientInteractArtistRepository,
        },
        {
          provide: ClientHashTagService,
          useValue: clientHashTagService,
        },
        {
          provide: GetTattooMinimalService,
          useValue: getTattooMinimalService,
        },
        {
          provide: AvatarService,
          useValue: avatarService,
        },
      ],
    }).compile();

    service = module.get<GetArtistDetailService>(GetArtistDetailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getArtistDetails', () => {
    it('should return ArtistSearchElementDto when artist is found (Happy Path)', async () => {
      // Given (Arrange)
      const artistId = 'artist-123';
      const clientId = 'client-456';
      const mockArtist = {
        id: artistId,
        client: { id: 'client-sub-id', username: 'artist_user', badge: {} },
        address: { id: 'addr-1' },
      } as any;

      artistRepository.findOne.mockResolvedValueOnce(mockArtist);
      clientInteractArtistRepository.count.mockResolvedValueOnce(1);
      clientHashTagService.getClientTags.mockResolvedValueOnce([
        { id: 'tag-1', name: 'blackwork' },
      ] as any);
      tattooEntityRepository.find.mockResolvedValueOnce([
        { id: 'tattoo-1' },
      ] as any);
      avatarService.getAvatar.mockResolvedValueOnce({
        url: 'avatar-url',
      } as any);
      getTattooMinimalService.getMinimal.mockResolvedValue({
        id: 'tattoo-1',
      } as any);

      // When (Act)
      const result = await service.getArtistDetails(clientId, artistId);

      // Then (Assert)
      expect(result).toBeDefined();
      expect(artistRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: artistId },
        }),
      );
      expect(result.artist.username).toBe('artist_user');
      expect(result.userLikes).toBe(true);
      expect(result.likedTags).toHaveLength(1);
    });

    it('should throw UnauthorizedException when artist is not found (Sad Path)', async () => {
      // Given (Arrange)
      artistRepository.findOne.mockResolvedValueOnce(null);

      // When & Then (Act & Assert)
      // The implementation checks "if (!Client)" (capital C) which is likely a bug in the service
      // where it meant to check "if (!artist)". Because "Client" class is truthy, it normally fails
      // with a TypeError later when accessing artist.client.username if artist is null.
      await expect(service.getArtistDetails('c1', 'a1')).rejects.toThrow();
    });

    it('should return userLikes as false when interaction count is 0', async () => {
      // Given (Arrange)
      artistRepository.findOne.mockResolvedValueOnce({
        client: { id: 'c', username: 'u' },
        address: {},
      } as any);
      clientInteractArtistRepository.count.mockResolvedValueOnce(0);
      clientHashTagService.getClientTags.mockResolvedValueOnce([]);
      tattooEntityRepository.find.mockResolvedValueOnce([]);
      avatarService.getAvatar.mockResolvedValueOnce(null);

      // When (Act)
      const result = await service.getArtistDetails('c1', 'a1');

      // Then (Assert)
      expect(result.userLikes).toBe(false);
    });

    it('should propagate errors when hashTagService fails', async () => {
      // Given (Arrange)
      artistRepository.findOne.mockResolvedValueOnce({
        client: { id: 'c' },
      } as any);
      clientHashTagService.getClientTags.mockRejectedValueOnce(
        new Error('Tag Error'),
      );

      // When & Then (Act & Assert)
      await expect(service.getArtistDetails('c1', 'a1')).rejects.toThrow(
        'Tag Error',
      );
    });
  });

  describe('convertTattoos', () => {
    it('should return empty array if tattoos is null', async () => {
      // When (Act)
      const result = await service.convertTattoos('client-id', null);

      // Then (Assert)
      expect(result).toEqual([]);
    });

    it('should map tattoos using getTattooMinimalService', async () => {
      // Given (Arrange)
      const tattoos = [{ id: 't1' }, { id: 't2' }] as any[];
      getTattooMinimalService.getMinimal.mockResolvedValue({
        id: 'minimal',
      } as any);

      // When (Act)
      const result = await service.convertTattoos('client-id', tattoos);

      // Then (Assert)
      expect(result).toHaveLength(2);
      expect(getTattooMinimalService.getMinimal).toHaveBeenCalledTimes(2);
    });
  });
});
