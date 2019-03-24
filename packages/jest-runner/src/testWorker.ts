/**
 * Copyright (c) Facebook, Inc. and its affiliates. All Rights Reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import {Config} from '@jest/types';
import {SerializableError, TestResult} from '@jest/test-result';
import HasteMap, {ModuleMap, SerializableModuleMap} from 'jest-haste-map';
import exit from 'exit';
import {separateMessageFromStack} from 'jest-message-util';
import Runtime from 'jest-runtime';
import Resolver from 'jest-resolve';
import {ErrorWithCode, TestRunnerSerializedContext} from './types';
import runTest from './runTest';

export type SerializableResolver = {
  config: Config.ProjectConfig;
  serializableModuleMap: SerializableModuleMap;
};

type WorkerData = {
  config: Config.ProjectConfig;
  globalConfig: Config.GlobalConfig;
  path: Config.Path;
  context?: TestRunnerSerializedContext;
};

// Make sure uncaught errors are logged before we exit.
process.on('uncaughtException', err => {
  console.error(err.stack);
  exit(1);
});

const formatError = (error: string | ErrorWithCode): SerializableError => {
  if (typeof error === 'string') {
    const {message, stack} = separateMessageFromStack(error);
    return {
      message,
      stack,
      type: 'Error',
    };
  }

  return {
    code: error.code || undefined,
    message: error.message,
    stack: error.stack,
    type: 'Error',
  };
};

const resolvers = new Map<string, Resolver>();
const getResolver = (config: Config.ProjectConfig, moduleMap?: ModuleMap) => {
  const name = config.name;
  if (moduleMap || !resolvers.has(name)) {
    resolvers.set(
      name,
      Runtime.createResolver(
        config,
        moduleMap || Runtime.createHasteMap(config).readModuleMap(),
      ),
    );
  }
  return resolvers.get(name)!;
};

export function setup(setupData?: {
  serializableResolvers: Array<SerializableResolver>;
}) {
  // Setup data is only used in watch mode to pass the latest version of all
  // module maps that will be used during the test runs. Otherwise, module maps
  // are loaded from disk as needed.
  if (setupData) {
    for (const {
      config,
      serializableModuleMap,
    } of setupData.serializableResolvers) {
      const moduleMap = HasteMap.ModuleMap.fromJSON(serializableModuleMap);
      getResolver(config, moduleMap);
    }
  }
}

export async function worker({
  config,
  globalConfig,
  path,
  context,
}: WorkerData): Promise<TestResult> {
  try {
    return await runTest(
      path,
      globalConfig,
      config,
      getResolver(config),
      context && {
        ...context,
        changedFiles: context.changedFiles && new Set(context.changedFiles),
      },
    );
  } catch (error) {
    throw formatError(error);
  }
}