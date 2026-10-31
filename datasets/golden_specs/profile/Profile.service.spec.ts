import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProfileService } from './Profile.service';
import { Client } from 'model/users/Client.entity';
import { Artist } from 'model/users/Artist.entity';
import { ClientInteractArtist } from 'model/users/relations/ClientInteractArtist.entity';
import { TattooEntity } from 'model/tattoo/Tattoo.entity';
import { Configurations } from 'model/Configurations.entity';
import { LeadEntity } from 'model/leads/Lead.entity';
import { ClientHashTagService } from 'modules/hashtags/ClientHashtag.service';
import { AddHashtagService } from 'modules/hashtags/AddHashtag.service';
import { AddStyleToUserService } from 'modules/tattoo/style/AddStyleToUser.service';
import { ClearHashtagInteractionService } from 'modules/hashtags/ClearHashtagInteraction.Service';
import { GetArtistExtraProfileService } from './GetArtistExtraProfile.service';
import { AvatarService } from 'modules/avatar/AvatarService';
import { FirebaseService } from 'modules/firebase/Firebase.service';
import { GetStyleService } from 'modules/tattoo/style/GetStyles.service';
import { LeadCollectorService } from 'modules/open/LeadCollector.service';
import { LegalService } from 'modules/legal/Legal.service';
import { AuthService } from 'modules/auth/AuthService';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MissingParameterException } from 'exceptions/MissingParameterException';
import { ApprovalStatus } from 'enums/ApprovalStatus';
import { LegalDocumentType } from 'enums/LegalDocumentType';

jest.mock('firebase-admin', () => ({
  auth: jest.fn().mockReturnValue({
    updateUser: jest.fn().mockResolvedValue({}),
  }),
}));

describe('ProfileService', () => {
  let service: ProfileService;
  let clientRepository: any;
  let artistRepository: any;
  let clientInteractArtistRepository: any;
  let tattooRepository: any;
  let configurationsRepository: any;
  let leadRepository: any;
  let clientHashTagService: any;
  let processNewHashtag: any;
  let addStyleToUserService: any;
  let clearHashtagInteractionService: any;
  let getArtistExtraProfileService: any;
  let avatarService: any;
  let firebaseService: any;
  let getStyleService: any;
  let leadCollectorService: any;
  let legalService: any;
  let authService: any;

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

    clientRepository = createMockRepository();
    artistRepository = createMockRepository();
    clientInteractArtistRepository = createMockRepository();
    tattooRepository = createMockRepository();
    configurationsRepository = createMockRepository();
    leadRepository = createMockRepository();
    clientHashTagService = {
      getClientTags: jest.fn().mockResolvedValue([]),
    };
    processNewHashtag = {
      addTagsToProfile: jest.fn().mockResolvedValue(undefined),
    };
    addStyleToUserService = {
      addStylesToProfile: jest.fn().mockResolvedValue(undefined),
      clearStylesFromProfile: jest.fn().mockResolvedValue(undefined),
    };
    clearHashtagInteractionService = {
      clearClientInteraction: jest.fn().mockResolvedValue(undefined),
    };
    getArtistExtraProfileService = {
      call: jest.fn().mockResolvedValue(null),
    };
    avatarService = {
      getAvatar: jest.fn().mockResolvedValue(null),
    };
    firebaseService = {
      changeCustomClaims: jest.fn().mockResolvedValue(undefined),
      getUserFromUid: jest.fn().mockResolvedValue({ emailVerified: false }),
    };
    getStyleService = {
      getStylesFromProfile: jest.fn().mockResolvedValue([]),
    };
    leadCollectorService = {
      collect: jest.fn().mockResolvedValue(undefined),
    };
    legalService = {
      getActiveDocument: jest.fn().mockResolvedValue(null),
      getFirstPendingDocumentType: jest.fn().mockResolvedValue(null),
      registerAcceptance: jest.fn().mockResolvedValue(undefined),
    };
    authService = {
      sendVerificationForUser: jest.fn().mockResolvedValue(undefined),
      sendWelcomeForUser: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: getRepositoryToken(Client), useValue: clientRepository },
        { provide: getRepositoryToken(Artist), useValue: artistRepository },
        {
          provide: getRepositoryToken(ClientInteractArtist),
          useValue: clientInteractArtistRepository,
        },
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooRepository,
        },
        {
          provide: getRepositoryToken(Configurations),
          useValue: configurationsRepository,
        },
        { provide: getRepositoryToken(LeadEntity), useValue: leadRepository },
        { provide: ClientHashTagService, useValue: clientHashTagService },
        { provide: AddHashtagService, useValue: processNewHashtag },
        { provide: AddStyleToUserService, useValue: addStyleToUserService },
        {
          provide: ClearHashtagInteractionService,
          useValue: clearHashtagInteractionService,
        },
        {
          provide: GetArtistExtraProfileService,
          useValue: getArtistExtraProfileService,
        },
        { provide: AvatarService, useValue: avatarService },
        { provide: FirebaseService, useValue: firebaseService },
        { provide: GetStyleService, useValue: getStyleService },
        { provide: LeadCollectorService, useValue: leadCollectorService },
        { provide: LegalService, useValue: legalService },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
  });

  describe('updateProfileDescription', () => {
    it('should throw MissingParameterException when firebaseId is null', async () => {
      await expect(
        service.updateProfileDescription(null as any, 'email@test.com', 'user'),
      ).rejects.toThrow(MissingParameterException);
    });

    it('should throw MissingParameterException when username is null', async () => {
      await expect(
        service.updateProfileDescription(
          'uid123',
          'email@test.com',
          null as any,
        ),
      ).rejects.toThrow(MissingParameterException);
    });

    it('should create a new client and update profile description when client does not exist', async () => {
      clientRepository.findOne.mockResolvedValueOnce(null);
      configurationsRepository.findOne.mockResolvedValueOnce(null);

      await service.updateProfileDescription(
        'uid123',
        'email@test.com',
        'username1',
        ['tag1'],
        'my description',
        [{ id: 'style1', name: 'Blackwork' } as any],
      );

      expect(clientRepository.save).toHaveBeenCalled();
      expect(
        clearHashtagInteractionService.clearClientInteraction,
      ).toHaveBeenCalledWith('uid123');
      expect(processNewHashtag.addTagsToProfile).toHaveBeenCalledWith(
        'uid123',
        ['tag1'],
      );
      expect(addStyleToUserService.clearStylesFromProfile).toHaveBeenCalledWith(
        'uid123',
      );
      expect(addStyleToUserService.addStylesToProfile).toHaveBeenCalledWith(
        'uid123',
        ['style1'],
      );
      expect(configurationsRepository.save).toHaveBeenCalled();
    });

    it('should update existing client description', async () => {
      const existingClient = {
        id: 'uid123',
        email: 'old@test.com',
        username: 'olduser',
        description: 'old desc',
        inviteCode: 'INV123',
      };
      clientRepository.findOne.mockResolvedValueOnce(existingClient as any);
      configurationsRepository.findOne.mockResolvedValueOnce({
        id: 'uid123',
      } as any);

      await service.updateProfileDescription(
        'uid123',
        'new@test.com',
        'newuser',
        [],
        'new desc',
      );

      expect(clientRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@test.com',
          description: 'new desc',
        }),
      );
    });
  });

  describe('getOwnProfileDescription', () => {
    it('should return empty description DTO if client is not found', async () => {
      clientRepository.findOne.mockResolvedValueOnce(null);

      const result = await service.getOwnProfileDescription('uid123');

      expect(result.id).toBe('uid123');
      expect(result.username).toBe('');
      expect(result.likedTags).toBeNull();
      expect(result.likedStyles).toBeNull();
      expect(result.description).toBe('');
    });

    it('should return profile description with tags and styles when client exists', async () => {
      const client = { id: 'uid123', username: 'user1', description: 'hello' };
      clientRepository.findOne.mockResolvedValueOnce(client as any);
      clientHashTagService.getClientTags.mockResolvedValueOnce(['tag1'] as any);
      getStyleService.getStylesFromProfile.mockResolvedValueOnce([
        { id: 'style1' },
      ] as any);

      const result = await service.getOwnProfileDescription('uid123');

      expect(result.id).toBe('uid123');
      expect(result.username).toBe('user1');
      expect(result.likedTags).toEqual(['tag1']);
      expect(result.likedStyles).toEqual([{ id: 'style1' }]);
      expect(result.description).toBe('hello');
    });
  });

  describe('getOwnProfileInfo', () => {
    it('should return default profile info if client and artist are not found', async () => {
      clientRepository.findOne.mockResolvedValueOnce(null);
      artistRepository.findOne.mockResolvedValueOnce(null);

      const result = await service.getOwnProfileInfo('uid123');

      expect(result.cpf).toBe('');
      expect(result.companyCNPJ).toBe('');
      expect(result.termsAccepted).toBe(false);
    });

    it('should return profile info when client and artist exist', async () => {
      const client = {
        id: 'uid123',
        cpf: '12345678909',
        birthDate: new Date('1990-01-01'),
        phone: '11999999999',
        name: 'John Doe',
      };
      const artist = {
        id: 'uid123',
        cnpj: '12345678000195',
        artistSince: 2018,
        phone: '11988888888',
      };
      clientRepository.findOne.mockResolvedValueOnce(client as any);
      artistRepository.findOne.mockResolvedValueOnce(artist as any);
      legalService.getFirstPendingDocumentType.mockResolvedValueOnce(null);

      const result = await service.getOwnProfileInfo('uid123');

      expect(result.cpf).toBe('12345678909');
      expect(result.companyCNPJ).toBe('12345678000195');
      expect(result.phone).toBe('11988888888');
      expect(result.termsAccepted).toBe(true);
      expect(result.name).toBe('John Doe');
    });
  });

  describe('updateProfileInfo', () => {
    it('should throw NotFoundException when client does not exist and soft-deleted record is not found', async () => {
      clientRepository.findOne.mockResolvedValueOnce(null);
      clientRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.updateProfileInfo(
          'uid123',
          'Name',
          '12345678909',
          '',
          '1990-01-01',
          2020,
          '11999999999',
          false,
          '127.0.0.1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should restore client if soft-deleted', async () => {
      const deletedClient = {
        id: 'uid123',
        email: 'user@test.com',
        name: 'User',
        deletedAt: new Date(),
      };
      clientRepository.findOne.mockResolvedValueOnce(null);
      clientRepository.findOne.mockResolvedValueOnce(deletedClient as any);
      leadRepository.findOne.mockResolvedValueOnce({
        firebaseId: 'uid123',
        email: 'user@test.com',
      } as any);

      await service.updateProfileInfo(
        'uid123',
        'User Restored',
        '',
        '',
        '1990-01-01',
        0,
        '11999999999',
        false,
        '127.0.0.1',
      );

      expect(clientRepository.restore).toHaveBeenCalledWith('uid123');
    });

    it('should throw BadRequestException if CPF is already used by another client', async () => {
      const client = { id: 'uid123', email: 'test@test.com' };
      clientRepository.findOne.mockResolvedValueOnce(client as any);
      clientRepository.findOne.mockResolvedValueOnce({
        id: 'uid999',
        cpf: '12345678909',
      } as any);

      await expect(
        service.updateProfileInfo(
          'uid123',
          'Name',
          '123.456.789-09',
          '',
          '1990-01-01',
          0,
          '11999999999',
          false,
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid CNPJ format when isArtist is true', async () => {
      const client = { id: 'uid123', email: 'artist@test.com' };
      clientRepository.findOne.mockResolvedValueOnce(client as any);
      artistRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.updateProfileInfo(
          'uid123',
          'Artist Name',
          '',
          'invalid-cnpj',
          '1990-01-01',
          2015,
          '11999999999',
          true,
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should process artist creation, custom claims, and legal acceptances', async () => {
      const client = { id: 'uid123', email: 'artist@test.com' };
      clientRepository.findOne.mockResolvedValueOnce(client as any);
      artistRepository.findOne.mockResolvedValueOnce(null);
      artistRepository.findOne.mockResolvedValueOnce(null); // soft-deleted check
      legalService.getActiveDocument
        .mockResolvedValueOnce({ id: 'privacy-1' })
        .mockResolvedValueOnce({ id: 'terms-1' });

      await service.updateProfileInfo(
        'uid123',
        'Artist Name',
        '',
        '11.222.333/0001-81',
        '1990-01-01',
        2018,
        '11999999999',
        true,
        '127.0.0.1',
        true,
      );

      expect(firebaseService.changeCustomClaims).toHaveBeenCalledWith(
        'uid123',
        'artist',
        true,
      );
      expect(legalService.registerAcceptance).toHaveBeenCalledWith(
        'uid123',
        'privacy-1',
        '127.0.0.1',
      );
      expect(legalService.registerAcceptance).toHaveBeenCalledWith(
        'uid123',
        'terms-1',
        '127.0.0.1',
      );
    });

    it('should handle non-artist demotion and soft delete artist', async () => {
      const client = { id: 'uid123', email: 'user@test.com' };
      clientRepository.findOne.mockResolvedValueOnce(client as any);
      artistRepository.findOne.mockResolvedValueOnce({ id: 'uid123' } as any);

      await service.updateProfileInfo(
        'uid123',
        'User Name',
        '',
        '',
        '1990-01-01',
        0,
        '11999999999',
        false,
        '127.0.0.1',
        false,
      );

      expect(artistRepository.softDelete).toHaveBeenCalledWith({
        id: 'uid123',
      });
      expect(firebaseService.changeCustomClaims).toHaveBeenCalledWith(
        'uid123',
        'artist',
        false,
      );
    });
  });

  describe('getProfileByIdOrName', () => {
    it('should return GenericProfileDto with empty fields if client is not found', async () => {
      clientRepository.createQueryBuilder().getOne.mockResolvedValueOnce(null);

      const result = await service.getProfileByIdOrName('uid123');

      expect(result.id).toBe('uid123');
      expect(result.username).toBe('');
      expect(result.likedTags).toBeNull();
    });

    it('should return GenericProfileDto with tags and styles when client is found', async () => {
      const client = {
        id: 'uid123',
        username: 'johndoe',
        description: 'Tattoo lover',
        instagramUsername: 'john_insta',
      };
      clientRepository
        .createQueryBuilder()
        .getOne.mockResolvedValueOnce(client as any);
      clientHashTagService.getClientTags.mockResolvedValueOnce([
        'tag1',
        'tag2',
      ] as any);
      getStyleService.getStylesFromProfile.mockResolvedValueOnce([
        { id: 'style1' },
      ] as any);

      const result = await service.getProfileByIdOrName('uid123');

      expect(result.id).toBe('uid123');
      expect(result.username).toBe('johndoe');
      expect(result.description).toBe('Tattoo lover');
      expect(result.likedTags).toEqual(['tag1', 'tag2']);
      expect(result.styles).toEqual([{ id: 'style1' }]);
    });
  });

  describe('getOtherProfilePage', () => {
    it('should throw NotFoundException if client is not found by ID or username', async () => {
      clientRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.getOtherProfilePage('reqUser', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return ProfileDto with generic profile, artist extra profile, and likes count', async () => {
      const client = { id: 'uid123', username: 'artistuser' };
      clientRepository.findOne.mockResolvedValueOnce(client as any);
      artistRepository.findOne.mockResolvedValueOnce({ id: 'uid123' } as any);

      clientRepository
        .createQueryBuilder()
        .getOne.mockResolvedValueOnce(client as any);
      avatarService.getAvatar.mockResolvedValueOnce('http://avatar.url');
      tattooRepository.count
        .mockResolvedValueOnce(5) // qtTattoos
        .mockResolvedValueOnce(2) // qtMarkedTattoos
        .mockResolvedValueOnce(1); // qtDrafts

      getArtistExtraProfileService.call.mockResolvedValueOnce({
        id: 'uid123',
        averageStars: 4.8,
      } as any);

      clientInteractArtistRepository.count.mockResolvedValueOnce(10); // numberOfLikes

      const result = await service.getOtherProfilePage('reqUser', 'artistuser');

      expect(result).toBeDefined();
      expect(result.numberOfLikes).toBe(10);
      expect(result.genericProfileData.avatar).toBe('http://avatar.url');
      expect(result.genericProfileData.qtTattoos).toBe(5);
      expect(result.genericProfileData.qtMarkedTattoos).toBe(2);
      expect(result.genericProfileData.qtDrafts).toBe(1);
    });
  });
});
