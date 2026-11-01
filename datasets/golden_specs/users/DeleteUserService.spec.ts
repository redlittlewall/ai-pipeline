import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeleteUserService } from './DeleteUserService';
import { FirebaseService } from 'modules/firebase/Firebase.service';
import { DeleteCommentService } from 'modules/comments/DeleteComment.service';
import { ArtistLocatesInAdresses } from 'model/address/ArtistLocatesInAdresses.entity';
import { Comment } from 'model/comments/Comment.entity';
import { ClientInteractHashtag } from 'model/hashtag/ClientInteractHashtag.entity';
import { Photo } from 'model/tattoo/Photo.entity';
import { TattooEntity } from 'model/tattoo/Tattoo.entity';
import { TattooDetailsHasHashtag } from 'model/hashtag/TattooHasHashtag.entity';
import { TattooDetails } from 'model/tattoo/TattooDetails.Entity';
import { Sponsors } from 'model/sponsor/Sponsor.entity';
import { ClientInteractArtist } from 'model/users/relations/ClientInteractArtist.entity';
import { ClientInteractComment } from 'model/users/relations/ClientInteractComment.entity';
import { ClientInteractTattoo } from 'model/users/relations/ClientInteractTattoo.entity';
import { Hashtag } from 'model/hashtag/Hashtag.entity';
import { Admin } from 'model/users/Admin.entity';
import { Artist } from 'model/users/Artist.entity';
import { Client } from 'model/users/Client.entity';
import { Avatar } from 'model/Avatar.entity';
import { Configurations } from 'model/Configurations.entity';
import { Contact } from 'model/Contact.entity';
import { ClientsTaggedInTattoo } from 'model/tattoo/ClientsTaggedInTattoo.entity';
import { ClientLogin } from 'model/users/ClientLogin.entity';
import { ClientInsideRoom } from 'model/sockets/ClientInsideRoom.entity';
import { Notifications } from 'model/notification/Notifications.entity';
import { SearchLog } from 'model/SearchLog.entity';
import { Budget } from 'model/budget/Budget.entity';
import { BudgetOffer } from 'model/budget/BudgetOffer.entity';
import { BudgetSchedule } from 'model/budget/BudgetSchedule.entity';
import { BudgetChatMessage } from 'model/budget/BudgetChatMessage.entity';
import { ReviewBudget } from 'model/budget/ReviewBudget.entity';
import { ClientInteractStyle } from 'model/tattoo/ClientInteractStyle.entity';
import { ArtistPayoutRequest } from 'model/payment/ArtistPayoutRequest.entity';
import { StripeAccountEntity } from 'model/stripe/StripeAccount.entity';
import { InternalServerErrorException } from '@nestjs/common';

describe('DeleteUserService', () => {
  let service: DeleteUserService;
  let firebaseService: any;
  let deleteCommentService: any;
  let artistLocatesInAdressesRepository: any;
  let commentRepository: any;
  let clientInteractHashtagRepository: any;
  let photoRepository: any;
  let tattooRepository: any;
  let tattooHasHashtagRepository: any;
  let tattooDetailsRepository: any;
  let sponsorsRepository: any;
  let clientInteractArtistRepository: any;
  let clientInteractCommentRepository: any;
  let clientInteractTattooRepository: any;
  let hashtagRepository: any;
  let adminRepository: any;
  let artistRepository: any;
  let clientRepository: any;
  let avatarRepository: any;
  let configurationsRepository: any;
  let contactRepository: any;
  let clientsTaggedInTattooRepository: any;
  let clientLoginRepository: any;
  let clientsTaggedRepository: any;
  let clientInsideRoomRepository: any;
  let notificationsRepository: any;
  let searchLogRepository: any;
  let budgetRepository: any;
  let budgetOfferRepository: any;
  let budgetScheduleRepository: any;
  let budgetChatMessageRepository: any;
  let reviewBudgetRepository: any;
  let clientInteractStyleRepository: any;
  let artistPayoutRequestRepository: any;
  let stripeAccountRepository: any;

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
    firebaseService = {
      deleteUser: jest.fn(),
    };
    deleteCommentService = {
      delete: jest.fn(),
    };
    artistLocatesInAdressesRepository = createMockRepository();
    commentRepository = createMockRepository();
    clientInteractHashtagRepository = createMockRepository();
    photoRepository = createMockRepository();
    tattooRepository = createMockRepository();
    tattooHasHashtagRepository = createMockRepository();
    tattooDetailsRepository = createMockRepository();
    sponsorsRepository = createMockRepository();
    clientInteractArtistRepository = createMockRepository();
    clientInteractCommentRepository = createMockRepository();
    clientInteractTattooRepository = createMockRepository();
    hashtagRepository = createMockRepository();
    adminRepository = createMockRepository();
    artistRepository = createMockRepository();
    clientRepository = createMockRepository();
    avatarRepository = createMockRepository();
    configurationsRepository = createMockRepository();
    contactRepository = createMockRepository();
    clientsTaggedInTattooRepository = createMockRepository();
    clientLoginRepository = createMockRepository();
    clientsTaggedRepository = createMockRepository();
    clientInsideRoomRepository = createMockRepository();
    notificationsRepository = createMockRepository();
    searchLogRepository = createMockRepository();
    budgetRepository = createMockRepository();
    budgetOfferRepository = createMockRepository();
    budgetScheduleRepository = createMockRepository();
    budgetChatMessageRepository = createMockRepository();
    reviewBudgetRepository = createMockRepository();
    clientInteractStyleRepository = createMockRepository();
    artistPayoutRequestRepository = createMockRepository();
    stripeAccountRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeleteUserService,
        {
          provide: FirebaseService,
          useValue: firebaseService,
        },
        {
          provide: DeleteCommentService,
          useValue: deleteCommentService,
        },
        {
          provide: getRepositoryToken(ArtistLocatesInAdresses),
          useValue: artistLocatesInAdressesRepository,
        },
        {
          provide: getRepositoryToken(Comment),
          useValue: commentRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractHashtag),
          useValue: clientInteractHashtagRepository,
        },
        {
          provide: getRepositoryToken(Photo),
          useValue: photoRepository,
        },
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooRepository,
        },
        {
          provide: getRepositoryToken(TattooDetailsHasHashtag),
          useValue: tattooHasHashtagRepository,
        },
        {
          provide: getRepositoryToken(TattooDetails),
          useValue: tattooDetailsRepository,
        },
        {
          provide: getRepositoryToken(Sponsors),
          useValue: sponsorsRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractArtist),
          useValue: clientInteractArtistRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractComment),
          useValue: clientInteractCommentRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractTattoo),
          useValue: clientInteractTattooRepository,
        },
        {
          provide: getRepositoryToken(Hashtag),
          useValue: hashtagRepository,
        },
        {
          provide: getRepositoryToken(Admin),
          useValue: adminRepository,
        },
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Avatar),
          useValue: avatarRepository,
        },
        {
          provide: getRepositoryToken(Configurations),
          useValue: configurationsRepository,
        },
        {
          provide: getRepositoryToken(Contact),
          useValue: contactRepository,
        },
        {
          provide: getRepositoryToken(ClientsTaggedInTattoo),
          useValue: clientsTaggedInTattooRepository,
        },
        {
          provide: getRepositoryToken(ClientLogin),
          useValue: clientLoginRepository,
        },
        {
          provide: getRepositoryToken(ClientsTaggedInTattoo),
          useValue: clientsTaggedRepository,
        },
        {
          provide: getRepositoryToken(ClientInsideRoom),
          useValue: clientInsideRoomRepository,
        },
        {
          provide: getRepositoryToken(Notifications),
          useValue: notificationsRepository,
        },
        {
          provide: getRepositoryToken(SearchLog),
          useValue: searchLogRepository,
        },
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
        {
          provide: getRepositoryToken(BudgetOffer),
          useValue: budgetOfferRepository,
        },
        {
          provide: getRepositoryToken(BudgetSchedule),
          useValue: budgetScheduleRepository,
        },
        {
          provide: getRepositoryToken(BudgetChatMessage),
          useValue: budgetChatMessageRepository,
        },
        {
          provide: getRepositoryToken(ReviewBudget),
          useValue: reviewBudgetRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractStyle),
          useValue: clientInteractStyleRepository,
        },
        {
          provide: getRepositoryToken(ArtistPayoutRequest),
          useValue: artistPayoutRequestRepository,
        },
        {
          provide: getRepositoryToken(StripeAccountEntity),
          useValue: stripeAccountRepository,
        },
      ],
    }).compile();

    service = module.get<DeleteUserService>(DeleteUserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('delete', () => {
    it('should execute delete successfully for a standard user', async () => {
      // Arrange
      artistRepository.findOne.mockResolvedValueOnce(null);
      budgetRepository.find.mockResolvedValueOnce([]);

      // Act
      await service.delete('user-123');

      // Assert
      expect(clientRepository.update).toHaveBeenCalled();
      expect(firebaseService.deleteUser).toHaveBeenCalledWith('user-123');
      expect(clientRepository.softDelete).toHaveBeenCalledWith({
        id: 'user-123',
      });
    });

    it('should handle artist and budget cleanup when user is an artist', async () => {
      // Arrange
      artistRepository.findOne.mockResolvedValueOnce({ id: 'artist-1' } as any);
      budgetRepository.find.mockResolvedValueOnce([{ id: 'budget-1' }] as any);

      // Act
      await service.delete('user-123');

      // Assert
      expect(stripeAccountRepository.softDelete).toHaveBeenCalledWith({
        artist: { id: 'artist-1' },
      });
      expect(budgetOfferRepository.softDelete).toHaveBeenCalled();
    });

    it('should perform full wipe when wipeData is true', async () => {
      // Arrange
      artistRepository.findOne.mockResolvedValueOnce(null);
      budgetRepository.find.mockResolvedValueOnce([]);
      commentRepository.find.mockResolvedValueOnce([
        { id: 'comment-1' },
      ] as any);
      photoRepository.find.mockResolvedValueOnce([
        { id: 'photo-1', tattoo: { id: 'tattoo-1' } },
      ] as any);

      // Act
      await service.delete('user-123', true);

      // Assert
      expect(deleteCommentService.delete).toHaveBeenCalledWith(
        'user-123',
        'comment-1',
      );
      expect(tattooRepository.softDelete).toHaveBeenCalled();
      expect(photoRepository.softDelete).toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException when firebase deletion fails', async () => {
      // Arrange
      firebaseService.deleteUser.mockRejectedValueOnce(
        new Error('Firebase error'),
      );

      // Act & Assert
      await expect(service.delete('user-123')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
