
import { UserService } from '../src/services/UserService';
import logger from '../src/utils/logger';

async function testUserService() {
  const userService = UserService.getInstance();
  const testUser = 'test_admin_' + Date.now();
  const testPass = 'secure_password_123';

  logger.info(`Testing UserService with user: ${testUser}`);

  try {
    // 1. Create User
    logger.info('Creating user...');
    const user = await userService.createUser(testUser, testPass);
    logger.info(`User created: ${JSON.stringify(user)}`);

    // 2. Verify User (Success)
    logger.info('Verifying password (correct)...');
    const verifiedUser = await userService.verifyUser(testUser, testPass);
    if (verifiedUser) {
      logger.info('Verification successful!');
    } else {
      logger.error('Verification failed!');
    }

    // 3. Verify User (Failure)
    logger.info('Verifying password (incorrect)...');
    const failedUser = await userService.verifyUser(testUser, 'wrong_password');
    if (!failedUser) {
      logger.info('Verification failed as expected!');
    } else {
      logger.error('Verification succeeded unexpectedly!');
    }

    // 4. Delete User
    logger.info('Deleting user...');
    const deleted = userService.deleteUser(testUser);
    logger.info(`User deleted: ${deleted}`);

  } catch (err) {
    logger.error(`Test failed: ${err}`);
  }
}

testUserService();
