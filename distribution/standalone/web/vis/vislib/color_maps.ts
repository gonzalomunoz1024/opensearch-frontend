/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The colour maps of the classic charts (vislibColorMaps of the charts plugin): each schema as 512
 * colours from the component library's palettes, the two that run between the status colours
 * of the theme in its light and its dark form, and the colour vislib reads off a map at a place
 * between 0 and 1 (getHeatmapColors): the two colours either side of it mixed in proportion, each
 * channel rounded. Taken from OpenSearch Dashboards 3.9.0 as built with the Atlas theme. Each map
 * is one string of 6-digit hex colours.
 */

const MAPS: Record<string, string> = {
  'Blues': [
    'fffffffefffffefefffefefffefefefdfefefdfdfefdfdfefcfdfefcfdfefcfdfefbfcfefbfcfdfbfcfdfbfcfdfafbfd',
    'fafbfdfafbfdf9fbfdf9fbfdf9fafcf8fafcf8fafcf8fafcf7f9fcf7f9fcf7f9fcf7f9fcf6f9fbf6f8fbf6f8fbf5f8fb',
    'f5f8fbf5f7fbf5f7fbf4f7fbf4f7faf4f7faf3f6faf3f6faf3f6faf2f6faf2f5faf2f5faf1f5f9f1f5f9f1f5f9f1f4f9',
    'f0f4f9f0f4f9f0f4f9eff3f9eff3f8eff3f8eff3f8eef2f8eef2f8eef2f8edf2f8edf2f8edf1f7ecf1f7ecf1f7ecf1f7',
    'ebf1f7ebf0f7ebf0f7ebf0f7eaf0f6eaeff6eaeff6e9eff6e9eff6e9eff6e8eef6e8eef6e8eef5e8eef5e7edf5e7edf5',
    'e7edf5e6edf5e6edf5e6ecf5e5ecf4e5ecf4e5ecf4e5ebf4e4ebf4e4ebf4e4ebf4e3ebf4e3eaf4e3eaf3e3eaf3e2eaf3',
    'e2e9f3e2e9f3e1e9f3e1e9f3e1e9f3e0e8f2e0e8f2e0e8f2dfe8f2dfe7f2dfe7f2dfe7f2dee7f2dee7f1dee6f1dde6f1',
    'dde6f1dde6f1dde6f1dce5f1dce5f1dce5f0dbe5f0dbe4f0dbe4f0dae4f0dae4f0dae4f0d9e3f0d9e3efd9e3efd9e3ef',
    'd8e2efd8e2efd8e2efd7e2efd7e2efd7e1eed6e1eed6e1eed6e1eed6e0eed5e0eed5e0eed5e0eed4e0edd4dfedd4dfed',
    'd3dfedd3dfedd3dfedd3deedd2deedd2deecd2deecd1ddecd1ddecd1ddecd0ddecd0ddecd0dcecd0dceccfdcebcfdceb',
    'cfdbebcedbebcedbebcedbebcddbebcddaebcddaeacddaeaccdaeaccd9eaccd9eacbd9eacbd9eacbd9eacad8e9cad8e9',
    'cad8e9cad8e9c9d8e9c9d7e9c9d7e9c8d7e9c8d7e8c8d6e8c7d6e8c7d6e8c7d6e8c7d6e8c6d5e8c6d5e8c6d5e7c5d5e7',
    'c5d5e7c5d4e7c4d4e7c4d4e7c4d4e7c4d3e7c3d3e6c3d3e6c3d3e6c2d3e6c2d2e6c2d2e6c1d2e6c1d2e6c1d1e5c1d1e5',
    'c0d1e5c0d1e5c0d1e5bfd0e5bfd0e5bfd0e5bed0e4bed0e4becfe4becfe4bdcfe4bdcfe4bdcee4bccee4bccee3bccee3',
    'bbcee3bbcde3bbcde3bacde3bacde3bacde3bacce3b9cce2b9cce2b9cce2b8cbe2b8cbe2b8cbe2b7cbe2b7cbe2b7cae1',
    'b7cae1b6cae1b6cae1b6cae1b5c9e1b5c9e1b5c9e1b4c9e0b4c8e0b4c8e0b4c8e0b3c8e0b3c8e0b3c7e0b2c7e0b2c7df',
    'b2c7dfb1c7dfb1c6dfb1c6dfb1c6dfb0c6dfb0c6dfb0c5deafc5deafc5deafc5deaec4deaec4deaec4deadc4deadc4dd',
    'adc3ddadc3ddacc3ddacc3ddacc3ddabc2ddabc2ddabc2dcaac2dcaac1dcaac1dcaac1dca9c1dca9c1dca9c0dca8c0dc',
    'a8c0dba8c0dba7c0dba7bfdba7bfdba6bfdba6bfdba6bedba6bedaa5bedaa5bedaa5bedaa4bddaa4bddaa4bddaa3bdda',
    'a3bdd9a3bcd9a2bcd9a2bcd9a2bcd9a2bcd9a1bbd9a1bbd9a1bbd8a0bbd8a0bad8a0bad89fbad89fbad89fbad89eb9d8',
    '9eb9d79eb9d79eb9d79db9d79db8d79db8d79cb8d79cb8d79cb8d69bb7d69bb7d69bb7d69ab7d69ab7d69ab6d69ab6d6',
    '99b6d599b6d599b5d598b5d598b5d598b5d597b5d597b4d597b4d496b4d496b4d496b4d496b3d495b3d495b3d495b3d4',
    '94b3d494b2d394b2d393b2d393b2d393b1d392b1d392b1d392b1d391b1d291b0d291b0d290b0d290b0d290b0d290afd2',
    '8fafd28fafd18fafd18eafd18eaed18eaed18daed18daed18daed18cadd08cadd08cadd08badd08bacd08bacd08bacd0',
    '8aacd08aaccf8aabcf89abcf89abcf89abcf88abcf88aacf88aacf87aace87aace87aace86a9ce86a9ce86a9ce85a9ce',
    '85a9ce85a8cd84a8cd84a8cd84a8cd84a8cd83a7cd83a7cd83a7cd82a7cd82a7cc82a6cc81a6cc81a6cc81a6cc80a5cc',
    '80a5cc80a5cc7fa5cb7fa5cb7fa4cb7ea4cb7ea4cb7ea4cb7da4cb7da3cb7da3ca7ca3ca7ca3ca7ca3ca7ba2ca7ba2ca',
    '7ba2ca7aa2ca7aa2c97aa1c97aa1c979a1c979a1c979a1c978a0c978a0c978a0c877a0c877a0c8779fc8769fc8769fc8',
    '769fc8759ec8759ec7759ec7749ec7749ec7749dc7739dc7739dc7739dc7729dc6729cc6729cc6719cc6719cc6719cc6',
    '709bc6709bc6709bc66f9bc56f9bc56f9ac56e9ac56e9ac56e9ac56d9ac56d99c56d99c46c99c46c99c46b99c46b98c4',
    '6b98c46b98c46a98c46a98c36997c36997c36997c36897c36897c36896c36796c36796c26796c26696c26695c26695c2',
    '6595c26595c26595c26494c16494c16494c16394c16394c16393c16293c16293c16193c06193c06192c06092c06092c0',
  ].join(''),
  'Greens': [
    'fffffffefffefefefefdfefefdfefefdfefdfcfdfdfcfdfdfbfdfdfbfdfcfbfdfcfafcfcfafcfcf9fcfbf9fcfbf9fcfb',
    'f8fbfbf8fbfaf7fbfaf7fbfaf7faf9f6faf9f6faf9f5faf9f5faf8f5f9f8f4f9f8f4f9f8f3f9f7f3f9f7f3f8f7f2f8f7',
    'f2f8f6f1f8f6f1f7f6f1f7f6f0f7f5f0f7f5f0f7f5eff6f5eff6f4eef6f4eef6f4eef6f3edf5f3edf5f3ecf5f3ecf5f2',
    'ecf4f2ebf4f2ebf4f2eaf4f1eaf4f1eaf3f1e9f3f1e9f3f0e8f3f0e8f3f0e8f2f0e7f2efe7f2efe6f2efe6f1efe6f1ee',
    'e5f1eee5f1eee4f1ede4f0ede4f0ede3f0ede3f0ece2f0ece2efece2efece1efebe1efebe0eeebe0eeebe0eeeadfeeea',
    'dfeeeadeedeadeede9deede9ddede9ddede9ddece8dcece8dcece8dbece8dbebe7dbebe7daebe7daebe7d9ebe6d9eae6',
    'd9eae6d8eae5d8eae5d7eae5d7e9e5d7e9e4d6e9e4d6e9e4d5e8e4d5e8e3d5e8e3d4e8e3d4e8e3d3e7e2d3e7e2d3e7e2',
    'd2e7e2d2e7e1d1e6e1d1e6e1d1e6e1d0e6e0d0e5e0cfe5e0cfe5e0cfe5dfcee5dfcee4dfcee4dfcde4decde4decce4de',
    'cce3decce3ddcbe3ddcbe3ddcae2dccae2dccae2dcc9e2dcc9e2dbc8e1dbc8e1dbc8e1dbc7e1dac7e1dac6e0dac6e0da',
    'c6e0d9c5e0d9c5dfd9c4dfd9c4dfd8c4dfd8c3dfd8c3ded8c2ded7c2ded7c2ded7c1ded7c1ddd6c0ddd6c0ddd6c0ddd6',
    'bfdcd5bfdcd5bfdcd5bedcd5bedcd4bddbd4bddbd4bddbd4bcdbd3bcdbd3bbdad3bbdad3bbdad2badad2bad9d2b9d9d2',
    'b9d9d1b9d9d1b8d9d1b8d8d1b7d8d0b7d8d0b7d8d0b6d8d0b6d7cfb5d7cfb5d7cfb5d7cfb4d6ceb4d6ceb3d6ceb3d6cd',
    'b3d6cdb2d5cdb2d5cdb1d5ccb1d5ccb1d5ccb0d4ccb0d4cbafd4cbafd4cbafd3cbaed3caaed3caaed3caadd3caadd2c9',
    'acd2c9acd2c9acd2c9abd2c8abd1c8aad1c8aad1c8aad1c7a9d0c7a9d0c7a8d0c7a8d0c6a8d0c6a7cfc6a7cfc6a6cfc5',
    'a6cfc5a6cfc5a5cec5a5cec4a4cec4a4cec4a4cec4a3cdc3a3cdc3a2cdc3a2cdc3a2ccc2a1ccc2a1ccc2a0ccc2a0ccc1',
    'a0cbc19fcbc19fcbc19ecbc09ecbc09ecac09dcac09dcabf9ccabf9cc9bf9cc9bf9bc9be9bc9be9ac9be9ac8be9ac8bd',
    '99c8bd99c8bd98c8bd98c7bc98c7bc97c7bc97c7bc96c6bb96c6bb96c6bb95c6bb95c6ba94c5ba94c5ba94c5ba93c5b9',
    '93c5b992c4b992c4b992c4b991c4b891c4b890c3b890c3b890c3b78fc3b78fc2b78ec2b78ec2b68ec2b68dc2b68dc1b6',
    '8cc1b58cc1b58cc1b58bc1b58bc0b48ac0b48ac0b48ac0b489bfb389bfb388bfb388bfb388bfb287beb287beb286beb2',
    '86beb186beb185bdb185bdb184bdb084bdb083bdb083bcb083bcaf82bcaf82bcaf81bbaf81bbae81bbae80bbae80bbae',
    '7fbaad7fbaad7fbaad7ebaad7ebaac7db9ac7db9ac7db9ac7cb9ab7cb8ab7bb8ab7bb8ab7ab8ab7ab8aa7ab7aa79b7aa',
    '79b7aa78b7a978b7a978b6a977b6a977b6a876b6a876b6a875b5a875b5a775b5a774b5a774b4a773b4a673b4a673b4a6',
    '72b4a672b3a571b3a571b3a570b3a570b3a470b2a46fb2a46fb2a46eb2a36eb1a36db1a36db1a36db1a36cb1a26cb0a2',
    '6bb0a26bb0a26bb0a16ab0a16aafa169afa169afa068afa068afa068aea067ae9f67ae9f66ae9f66ad9f65ad9e65ad9e',
    '64ad9e64ad9e64ac9d63ac9d63ac9d62ac9d62ac9c61ab9c61ab9c61ab9c60ab9c60aa9b5faa9b5faa9b5eaa9b5eaa9a',
    '5da99a5da99a5da99a5ca9995ca9995ba8995ba8995aa8985aa89859a89859a79858a79758a79758a79757a69757a697',
    '56a69656a69655a69655a59654a59554a59553a59553a59552a49452a49452a49451a49451a49350a39350a3934fa393',
    '4fa3924ea2924ea2924da2924da2924ca2914ca1914ba1914ba1914aa1904aa19049a09049a09048a08f48a08f47a08f',
    '479f8f469f8e469f8e459f8e459e8e449e8e449e8d439e8d439e8d429d8d429d8c419d8c419d8c409d8c409c8b3f9c8b',
    '3f9c8b3e9c8b3d9b8a3d9b8a3c9b8a3c9b8a3b9b8a3b9a893a9a893a9a89399a89389a88389988379988379988369987',
    '3699873598873498873498863398863397863297863197863197853097852f96852f96852e96842d96842d96842c9584',
    '2b95832b95832a9583299583299483289482279482269482269382259381249381239381239381229280219280209280',
  ].join(''),
  'Greys': [
    'fefffffefefefdfefefdfdfefcfdfefcfcfdfbfcfdfbfcfdfafbfcfafbfcf9fafcf9fafbf8f9fbf8f9fbf7f9fbf7f8fa',
    'f6f8faf6f7faf5f7f9f5f6f9f4f6f9f4f6f8f4f5f8f3f5f8f3f4f7f2f4f7f2f3f7f1f3f7f1f3f6f0f2f6f0f2f6eff1f5',
    'eff1f5eef0f5eef0f4edf0f4edeff4eceff3eceef3ebeef3ebeef2eaedf2eaedf2e9ecf1e9ecf1e8ebf1e8ebf0e7ebf0',
    'e7eaf0e7eaefe6e9efe6e9efe5e8eee5e8eee4e8eee4e7ede3e7ede3e6ede2e6ece2e5ece1e5ece1e5ebe0e4ebe0e4eb',
    'dfe3eadfe3eadfe2eadee2e9dee2e9dde1e9dde1e8dce0e8dce0e8dbe0e7dbdfe7dadfe7dadee6d9dee6d9dde5d8dde5',
    'd8dde5d8dce4d7dce4d7dbe4d6dbe3d6dae3d5dae3d5dae2d4d9e2d4d9e2d3d8e1d3d8e1d3d8e1d2d7e0d2d7e0d1d6df',
    'd1d6dfd0d5dfd0d5decfd5decfd4deced4ddced3ddced3ddcdd3dccdd2dcccd2dbccd1dbcbd1dbcbd0dacad0dacad0da',
    'cacfd9c9cfd9c9ced9c8ced8c8ced8c7cdd7c7cdd7c6ccd7c6ccd6c6cbd6c5cbd6c5cbd5c4cad5c4cad5c3c9d4c3c9d4',
    'c2c9d3c2c8d3c2c8d3c1c7d2c1c7d2c0c6d2c0c6d1bfc6d1bfc5d0bfc5d0bec4d0bec4cfbdc4cfbdc3cfbcc3cebcc2ce',
    'bbc2cdbbc2cdbbc1cdbac1ccbac0ccb9c0ccb9bfcbb8bfcbb8bfcab8becab7becab7bdc9b6bdc9b6bdc9b5bcc8b5bcc8',
    'b5bbc7b4bbc7b4bbc7b3bac6b3bac6b2b9c6b2b9c5b2b9c5b1b8c4b1b8c4b0b7c4b0b7c3b0b6c3afb6c3afb6c2aeb5c2',
    'aeb5c1adb4c1adb4c1adb4c0acb3c0acb3bfabb2bfabb2bfaab2beaab1beaab1bea9b0bda9b0bda8b0bca8afbca8afbc',
    'a7aebba7aebba6aebaa6adbaa6adbaa5acb9a5acb9a4acb9a4abb8a3abb8a3aab7a3aab7a2a9b7a2a9b6a1a9b6a1a8b5',
    'a1a8b5a0a7b5a0a7b49fa7b49fa6b49fa6b39ea5b39ea5b29da5b29da4b29da4b19ca3b19ca3b09ba3b09ba2b09aa2af',
    '9aa1af9aa1ae99a1ae99a0ae98a0ad989fad989fad979fac979eac969eab969dab969dab959daa959caa949ca9949ca9',
    '949ba9939ba8939aa8929aa79299a79299a79199a69198a69198a69098a59097a58f97a48f96a48f96a48e96a38e95a3',
    '8d95a28d94a28d94a28c94a18c93a18b93a08b92a08b92a08a929f8a919f89919e89909e89909e88909d888f9d888f9c',
    '878e9c878e9c868e9b868d9b868d9b858c9a858c9a848c99848b99848b99838b98838a98838a97828997828997818996',
    '8188968188958087958087958087947f86947f86937e85937e85937e85927d84927d84917c84917c83917c83907b8290',
    '7b82907b828f7a818f7a818e79808e79808e79808d787f8d787f8c787f8c777e8c777e8b777d8b767d8a767d8a757c8a',
    '757c89757b89747b88747b88747a88737a87737a87727987727986727886717885717885717785707784707784707683',
    '6f76836f75836e75826e75826e74816d74816d74816d73806c73806c727f6c727f6b727f6b717e6a717e6a717d6a707d',
    '69707d696f7c696f7c686f7c686e7b686e7b676e7a676d7a666d7a666c79666c79656c78656b78656b78646a77646a77',
    '646a776369766369766369756268756268756268746167746167736066736066736066725f65725f65715f65715e6471',
    '5e64705e63705d63705d636f5d626f5c626e5c626e5c616e5b616d5b606d5b606c5a606c5a5f6c595f6b595f6b595e6a',
    '585e6a585e6a585d69575d69575c69575c68565c68565b67565b67555b67555a66555a66545a66545965545965535864',
    '5358645358645257635257635257625156625156625156615055615055615055604f54604f545f4f535f4e535f4e535e',
    '4e525e4d525e4d525d4d515d4c515c4c515c4c505c4b505b4b505b4b4f5b4a4f5a4a4e5a4a4e59494e59494d59494d58',
    '484d58484c58484c57474c57474b56474b56464b56464a55464a55454a55454954454954444854444853444853434752',
    '43475243475242465142465142465141455041455041454f40444f40444f40444e3f434e3f434e3f434d3e424d3e424d',
    '3e424c3d414c3d414b3d404b3d404b3c404a3c3f4a3c3f4a3b3f493b3e493b3e493a3e483a3d483a3d47393d47393c47',
    '393c46383c46383b46383b45373b45373a45373a44373a44363944363943363943353842353842353842343741343741',
  ].join(''),
  'Reds': [
    'fffffffffefefffefefffefdfffdfdfffdfdfffdfcfffcfcfffcfbfffcfbfffbfbfffbfafffbfafffaf9fffaf9fffaf9',
    'fef9f8fef9f8fef9f7fef8f7fef8f7fef8f6fef7f6fef7f5fef7f5fef6f5fef6f4fef6f4fef5f3fef5f3fef5f3fef4f2',
    'fef4f2fef4f1fef3f1fef3f1fef3f0fef2f0fef2effef2effef1effef1eefef1eefef0edfdf0edfdf0edfdefecfdefec',
    'fdefebfdeeebfdeeebfdeeeafdedeafdede9fdede9fdece9fdece8fdece8fdebe7fdebe7fdebe7fdeae6fdeae6fdeae5',
    'fde9e5fde9e5fce9e4fce8e4fce8e4fce8e3fce7e3fce7e2fce7e2fce6e2fce6e1fce6e1fce5e0fce5e0fce5e0fce4df',
    'fce4dffce4defce3defce3defce3ddfbe2ddfbe2dcfbe2dcfbe1dcfbe1dbfbe1dbfbe0dafbe0dafbe0dafbdfd9fbdfd9',
    'fbdfd9fbdfd8fbded8fbded7fbded7fbddd7fbddd6faddd6fadcd5fadcd5fadcd5fadbd4fadbd4fadbd3fadad3fadad3',
    'fadad2fad9d2fad9d2fad9d1fad8d1fad8d0fad8d0f9d7d0f9d7cff9d7cff9d6cef9d6cef9d6cef9d5cdf9d5cdf9d5cc',
    'f9d4ccf9d4ccf9d4cbf9d3cbf9d3cbf9d3caf8d2caf8d2c9f8d2c9f8d1c9f8d1c8f8d1c8f8d0c7f8d0c7f8d0c7f8cfc6',
    'f8cfc6f8cfc6f8cec5f8cec5f7cec4f7cdc4f7cdc4f7cdc3f7ccc3f7ccc2f7ccc2f7cbc2f7cbc1f7cbc1f7cac1f7cac0',
    'f7cac0f7c9bff6c9bff6c9bff6c8bef6c8bef6c8bdf6c8bdf6c7bdf6c7bcf6c7bcf6c6bcf6c6bbf6c6bbf5c5baf5c5ba',
    'f5c5baf5c4b9f5c4b9f5c4b9f5c3b8f5c3b8f5c3b7f5c2b7f5c2b7f5c2b6f5c1b6f4c1b5f4c1b5f4c0b5f4c0b4f4c0b4',
    'f4bfb4f4bfb3f4bfb3f4beb2f4beb2f4beb2f3bdb1f3bdb1f3bdb1f3bcb0f3bcb0f3bcaff3bbaff3bbaff3bbaef3baae',
    'f3baaef3baadf2b9adf2b9acf2b9acf2b8acf2b8abf2b8abf2b8abf2b7aaf2b7aaf2b7a9f2b6a9f1b6a9f1b6a8f1b5a8',
    'f1b5a8f1b5a7f1b4a7f1b4a6f1b4a6f1b3a6f1b3a5f0b3a5f0b2a5f0b2a4f0b2a4f0b1a3f0b1a3f0b1a3f0b0a2f0b0a2',
    'f0b0a2efafa1efafa1efafa0efaea0efaea0efae9fefad9fefad9fefad9eefac9eefac9deeac9deeab9deeab9ceeab9c',
    'eeaa9ceeaa9beeaa9beeaa9aeea99aeda99aeda999eda899eda899eda898eda798eda798eda797eda697eda696eca696',
    'eca596eca595eca595eca495eca494eca494eca393eca393eba393eba292eba292eba292eba191eba191eba191eba090',
    'eba090eaa08fea9f8fea9f8fea9f8eea9e8eea9e8eea9e8dea9d8dea9d8de99d8ce99d8ce99c8be99c8be99c8be99b8a',
    'e99b8ae99b8ae99a89e89a89e89a89e89988e89988e89987e89887e89887e89886e89786e79786e79785e79685e79685',
    'e79684e79584e79583e79583e69483e69482e69482e69382e69381e69381e69281e69280e59280e59180e5917fe5917f',
    'e5907ee5907ee5907ee58f7de58f7de48f7de48f7ce48e7ce48e7ce48e7be48d7be48d7be48d7ae38c7ae38c79e38c79',
    'e38b79e38b78e38b78e38a78e38a77e28a77e28977e28976e28976e28876e28875e28875e18774e18774e18774e18673',
    'e18673e18673e18572e18572e08572e08471e08471e08471e08370e08370e08370e0826fdf826fdf826edf816edf816e',
    'df816ddf806ddf806dde806cde7f6cde7f6cde7f6bde7e6bde7e6bde7e6add7d6add7d6add7d69dd7d69dd7c69dd7c68',
    'dd7c68dd7b67dc7b67dc7b67dc7a66dc7a66dc7a66dc7965dc7965db7965db7864db7864db7864db7763db7763db7763',
    'da7662da7662da7662da7561da7561da7561da7460d97460d9745fd9735fd9735fd9735ed9725ed9725ed8725dd8715d',
    'd8715dd8715cd8705cd8705cd8705bd76f5bd76f5bd76f5ad76e5ad76e5ad76e59d76d59d66d59d66d58d66c58d66c58',
    'd66c57d66b57d66b57d56b56d56a56d56a56d56a55d56955d56955d46954d46854d46853d46853d46753d46752d46752',
    'd36652d36651d36651d36551d36550d36450d26450d2644fd2634fd2634fd2634ed2624ed2624ed1624dd1614dd1614d',
    'd1614cd1604cd1604cd0604bd05f4bd05f4bd05f4ad05e4ad05e4ad05e49cf5d49cf5d49cf5d48cf5c48cf5c48cf5c47',
    'ce5b47ce5b47ce5b46ce5a46ce5a46ce5a45cd5945cd5945cd5844cd5844cd5844cd5743cc5743cc5743cc5642cc5642',
  ].join(''),
  'Yellow to Red': [
    'ff9500ff9500ff9500ff9400ff9400ff9400ff9401ff9401ff9401ff9301ff9301ff9301ff9301ff9301ff9301ff9201',
    'ff9202ff9202ff9202ff9202ff9102ff9102ff9102ff9102ff9102ff9102ff9002ff9003ff9003ff9003ff9003ff9003',
    'ff8f03ff8f03ff8f03ff8f03ff8f03ff8e03ff8e04ff8e04ff8e04ff8e04ff8e04ff8d04ff8d04ff8d04ff8d04ff8d04',
    'ff8d05ff8c05ff8c05ff8c05ff8c05ff8c05ff8b05ff8b05ff8b05ff8b05ff8b05ff8b06ff8a06ff8a06ff8a06ff8a06',
    'ff8a06ff8a06ff8906ff8906ff8906ff8906ff8907ff8807ff8807ff8807ff8807ff8807ff8807ff8707ff8707ff8707',
    'ff8708ff8708ff8708ff8608ff8608ff8608ff8608ff8608ff8608ff8508ff8508ff8509ff8509ff8509ff8409ff8409',
    'ff8409ff8409ff8409ff8409ff8309ff8309ff830aff830aff830aff830aff820aff820aff820aff820aff820aff810a',
    'ff810bff810bff810bff810bff810bff800bff800bff800bff800bff800bff800bff7f0cff7f0cff7f0cff7f0cff7f0c',
    'ff7e0cff7e0cff7e0cff7e0cff7e0cff7e0cff7d0dff7d0dff7d0dff7d0dff7d0dff7d0dff7c0dff7c0dff7c0dff7c0d',
    'ff7c0eff7b0eff7b0eff7b0eff7b0eff7b0eff7b0eff7a0eff7a0eff7a0eff7a0eff7a0fff7a0fff790fff790fff790f',
    'ff790fff790fff780fff780fff780fff780fff7810ff7810ff7710ff7710ff7710ff7710ff7710ff7710ff7610ff7610',
    'ff7611ff7611ff7611ff7511ff7511ff7511ff7511ff7511ff7511ff7411ff7411ff7412ff7412ff7412ff7412ff7312',
    'ff7312ff7312ff7312ff7312ff7212ff7213ff7213ff7213ff7213ff7213ff7113ff7113ff7113ff7113ff7113ff7113',
    'ff7014ff7014ff7014ff7014ff7014ff6f14ff6f14ff6f14ff6f14ff6f14ff6f14ff6e15ff6e15ff6e15ff6e15ff6e15',
    'ff6e15ff6d15ff6d15ff6d15ff6d15ff6d16ff6c16ff6c16ff6c16ff6c16ff6c16ff6c16ff6b16ff6b16ff6b16ff6b16',
    'ff6b17ff6b17ff6a17ff6a17ff6a17ff6a17ff6a17ff6917ff6917ff6917ff6917ff6918ff6918ff6818ff6818ff6818',
    'ff6818ff6818ff6818ff6718ff6718ff6719ff6719ff6719ff6719ff6619ff6619ff6619ff6619ff6619ff6519ff6519',
    'ff651aff651aff651aff651aff641aff641aff641aff641aff641aff641aff631aff631bff631bff631bff631bff621b',
    'ff621bff621bff621bff621bff621bff611cff611cff611cff611cff611cff611cff601cff601cff601cff601cff601c',
    'ff5f1dff5f1dff5f1dff5f1dff5f1dff5f1dff5e1dff5e1dff5e1dff5e1dff5e1dff5e1eff5d1eff5d1eff5d1eff5d1e',
    'ff5d1eff5c1eff5c1eff5c1eff5c1eff5c1fff5c1fff5b1fff5b1fff5b1fff5b1fff5b1fff5b1fff5a1fff5a1fff5a1f',
    'ff5a20ff5a20ff5920ff5920ff5920ff5920ff5920ff5920ff5820ff5820ff5821ff5821ff5821ff5821ff5721ff5721',
    'ff5721ff5721ff5721ff5621ff5621ff5622ff5622ff5622ff5622ff5522ff5522ff5522ff5522ff5522ff5522ff5422',
    'ff5423ff5423ff5423ff5423ff5323ff5323ff5323ff5323ff5323ff5323ff5224ff5224ff5224ff5224ff5224ff5224',
    'ff5124ff5124ff5124ff5124ff5124ff5025ff5025ff5025ff5025ff5025ff5025ff4f25ff4f25ff4f25ff4f25ff4f25',
    'ff4f26ff4e26ff4e26ff4e26ff4e26ff4e26ff4d26ff4d26ff4d26ff4d26ff4d27ff4d27ff4c27ff4c27ff4c27ff4c27',
    'ff4c27ff4c27ff4b27ff4b27ff4b27ff4b28ff4b28ff4a28ff4a28ff4a28ff4a28ff4a28ff4a28ff4928ff4928ff4928',
    'ff4929ff4929ff4929ff4829ff4829ff4829ff4829ff4829ff4829ff4729ff472aff472aff472aff472aff462aff462a',
    'ff462aff462aff462aff462aff452aff452bff452bff452bff452bff452bff442bff442bff442bff442bff442bff432b',
    'ff432cff432cff432cff432cff432cff422cff422cff422cff422cff422cff422dff412dff412dff412dff412dff412d',
    'ff402dff402dff402dff402dff402dff402eff3f2eff3f2eff3f2eff3f2eff3f2eff3f2eff3e2eff3e2eff3e2eff3e2e',
    'ff3e2fff3d2fff3d2fff3d2fff3d2fff3d2fff3d2fff3c2fff3c2fff3c2fff3c30ff3c30ff3c30ff3b30ff3b30ff3b30',
  ].join(''),
  'Green to Red': [
    '34c75935c75936c75836c65837c65838c65739c6573ac6573ac5563bc5563cc5563dc5553ec5553ec4543fc45440c454',
    '41c45342c45342c35343c35244c35245c35245c35146c25147c25148c25049c25049c2504ac24f4bc14f4cc14f4dc14e',
    '4dc14e4ec14e4fc04d50c04d51c04c51c04c52c04c53bf4b54bf4b55bf4b55bf4a56bf4a57be4a58be4959be4959be49',
    '5abe485bbd485cbd485dbd475dbd475ebd475fbc4660bc4660bc4561bc4562bc4563bb4464bb4464bb4465bb4366bb43',
    '67ba4368ba4268ba4269ba426aba416bb9416cb9416cb9406db9406eb9406fb93f70b83f70b83f71b83e72b83e73b83d',
    '74b73d74b73d75b73c76b73c77b73c78b63b78b63b79b63b7ab63a7bb63a7cb53a7cb5397db5397eb5397fb5387fb438',
    '80b43881b43782b43783b43783b33684b33685b33586b33587b33587b23488b23489b2348ab2338bb2338bb1338cb132',
    '8db1328eb1328fb1318fb03190b03191b03092b03093b03093b02f94af2f95af2f96af2e97af2e97af2d98ae2d99ae2d',
    '9aae2c9aae2c9bae2c9cad2b9dad2b9ead2b9ead2a9fad2aa0ac2aa1ac29a2ac29a2ac29a3ac28a4ab28a5ab28a6ab27',
    'a6ab27a7ab26a8aa26a9aa26aaaa25aaaa25abaa25aca924ada924aea924aea923afa923b0a823b1a822b2a822b2a822',
    'b3a821b4a721b5a721b6a720b6a720b7a720b8a71fb9a61fb9a61ebaa61ebba61ebca61dbda51dbda51dbea51cbfa51c',
    'c0a51cc1a41bc1a41bc2a41bc3a41ac4a41ac5a31ac5a319c6a319c7a319c8a318c9a218c9a218caa217cba217cca216',
    'cda116cda116cea115cfa115d0a115d1a014d1a014d2a014d3a013d4a013d49f13d59f12d69f12d79f12d89f11d89e11',
    'd99e11da9e10db9e10dc9e10dc9e0fdd9d0fde9d0edf9d0ee09d0ee09d0de19c0de29c0de39c0ce49c0ce49c0ce59b0b',
    'e69b0be79b0be89b0ae89b0ae99a0aea9a09eb9a09ec9a09ec9a08ed9908ee9907ef9907f09907f09906f19806f29806',
    'f39805f39805f49805f59704f69704f79704f79703f89703f99603fa9602fb9602fb9602fc9601fd9501fe9501ff9500',
    'ff9500ff9400ff9400ff9401ff9301ff9301ff9301ff9201ff9202ff9202ff9102ff9102ff9102ff9003ff9003ff9003',
    'ff8f03ff8f03ff8e03ff8e04ff8e04ff8d04ff8d04ff8d04ff8c05ff8c05ff8c05ff8b05ff8b05ff8b06ff8a06ff8a06',
    'ff8a06ff8906ff8906ff8807ff8807ff8807ff8707ff8707ff8708ff8608ff8608ff8608ff8508ff8509ff8509ff8409',
    'ff8409ff8409ff8309ff830aff830aff820aff820aff810aff810bff810bff800bff800bff800bff7f0cff7f0cff7f0c',
    'ff7e0cff7e0cff7e0cff7d0dff7d0dff7d0dff7c0dff7c0dff7b0eff7b0eff7b0eff7a0eff7a0eff7a0fff790fff790f',
    'ff790fff780fff780fff7810ff7710ff7710ff7710ff7610ff7611ff7511ff7511ff7511ff7411ff7412ff7412ff7312',
    'ff7312ff7312ff7213ff7213ff7213ff7113ff7113ff7113ff7014ff7014ff6f14ff6f14ff6f14ff6e15ff6e15ff6e15',
    'ff6d15ff6d15ff6d16ff6c16ff6c16ff6c16ff6b16ff6b16ff6b17ff6a17ff6a17ff6917ff6917ff6918ff6818ff6818',
    'ff6818ff6718ff6719ff6719ff6619ff6619ff6619ff6519ff651aff651aff641aff641aff641aff631bff631bff621b',
    'ff621bff621bff611cff611cff611cff601cff601cff601cff5f1dff5f1dff5f1dff5e1dff5e1dff5e1eff5d1eff5d1e',
    'ff5c1eff5c1eff5c1fff5b1fff5b1fff5b1fff5a1fff5a1fff5a20ff5920ff5920ff5920ff5820ff5821ff5821ff5721',
    'ff5721ff5621ff5622ff5622ff5522ff5522ff5522ff5422ff5423ff5423ff5323ff5323ff5323ff5224ff5224ff5224',
    'ff5124ff5124ff5025ff5025ff5025ff4f25ff4f25ff4f25ff4e26ff4e26ff4e26ff4d26ff4d26ff4d27ff4c27ff4c27',
    'ff4c27ff4b27ff4b28ff4a28ff4a28ff4a28ff4928ff4928ff4929ff4829ff4829ff4829ff4729ff472aff472aff462a',
    'ff462aff462aff452bff452bff452bff442bff442bff432bff432cff432cff422cff422cff422cff412dff412dff412d',
    'ff402dff402dff402eff3f2eff3f2eff3f2eff3e2eff3e2eff3d2fff3d2fff3d2fff3c2fff3c2fff3c30ff3b30ff3b30',
  ].join(''),
};

/** The maps that run between status colours, in the dark form of the theme */
const DARK_MAPS: Record<string, string> = {
  'Yellow to Red': [
    'ff9f0aff9f0aff9f0aff9e0aff9e0aff9e0aff9e0bff9e0bff9e0bff9d0bff9d0bff9d0bff9d0bff9d0bff9d0bff9c0b',
    'ff9c0cff9c0cff9c0cff9c0cff9b0cff9b0cff9b0cff9b0cff9b0cff9b0cff9a0cff9a0dff9a0dff9a0dff9a0dff9a0d',
    'ff990dff990dff990dff990dff990dff980dff980eff980eff980eff980eff980eff970eff970eff970eff970eff970e',
    'ff970fff960fff960fff960fff960fff960fff950fff950fff950fff950fff950fff9510ff9410ff9410ff9410ff9410',
    'ff9410ff9410ff9310ff9310ff9310ff9310ff9311ff9211ff9211ff9211ff9211ff9211ff9211ff9111ff9111ff9111',
    'ff9112ff9112ff9112ff9012ff9012ff9012ff9012ff9012ff9012ff8f12ff8f12ff8f13ff8f13ff8f13ff8e13ff8e13',
    'ff8e13ff8e13ff8e13ff8e13ff8d13ff8d13ff8d14ff8d14ff8d14ff8d14ff8c14ff8c14ff8c14ff8c14ff8c14ff8b14',
    'ff8b15ff8b15ff8b15ff8b15ff8b15ff8a15ff8a15ff8a15ff8a15ff8a15ff8a15ff8916ff8916ff8916ff8916ff8916',
    'ff8816ff8816ff8816ff8816ff8816ff8816ff8717ff8717ff8717ff8717ff8717ff8717ff8617ff8617ff8617ff8617',
    'ff8618ff8518ff8518ff8518ff8518ff8518ff8518ff8418ff8418ff8418ff8418ff8419ff8419ff8319ff8319ff8319',
    'ff8319ff8319ff8219ff8219ff8219ff8219ff821aff821aff811aff811aff811aff811aff811aff811aff801aff801a',
    'ff801bff801bff801bff7f1bff7f1bff7f1bff7f1bff7f1bff7f1bff7e1bff7e1bff7e1cff7e1cff7e1cff7e1cff7d1c',
    'ff7d1cff7d1cff7d1cff7d1cff7c1cff7c1dff7c1dff7c1dff7c1dff7c1dff7b1dff7b1dff7b1dff7b1dff7b1dff7b1d',
    'ff7a1eff7a1eff7a1eff7a1eff7a1eff791eff791eff791eff791eff791eff791eff781fff781fff781fff781fff781f',
    'ff781fff771fff771fff771fff771fff7720ff7620ff7620ff7620ff7620ff7620ff7620ff7520ff7520ff7520ff7520',
    'ff7521ff7521ff7421ff7421ff7421ff7421ff7421ff7321ff7321ff7321ff7321ff7322ff7322ff7222ff7222ff7222',
    'ff7222ff7222ff7222ff7122ff7122ff7123ff7123ff7123ff7123ff7023ff7023ff7023ff7023ff7023ff6f23ff6f23',
    'ff6f24ff6f24ff6f24ff6f24ff6e24ff6e24ff6e24ff6e24ff6e24ff6e24ff6d24ff6d25ff6d25ff6d25ff6d25ff6c25',
    'ff6c25ff6c25ff6c25ff6c25ff6c25ff6b26ff6b26ff6b26ff6b26ff6b26ff6b26ff6a26ff6a26ff6a26ff6a26ff6a26',
    'ff6927ff6927ff6927ff6927ff6927ff6927ff6827ff6827ff6827ff6827ff6827ff6828ff6728ff6728ff6728ff6728',
    'ff6728ff6628ff6628ff6628ff6628ff6629ff6629ff6529ff6529ff6529ff6529ff6529ff6529ff6429ff6429ff6429',
    'ff642aff642aff632aff632aff632aff632aff632aff632aff622aff622aff622bff622bff622bff622bff612bff612b',
    'ff612bff612bff612bff602bff602bff602cff602cff602cff602cff5f2cff5f2cff5f2cff5f2cff5f2cff5f2cff5e2c',
    'ff5e2dff5e2dff5e2dff5e2dff5d2dff5d2dff5d2dff5d2dff5d2dff5d2dff5c2eff5c2eff5c2eff5c2eff5c2eff5c2e',
    'ff5b2eff5b2eff5b2eff5b2eff5b2eff5a2fff5a2fff5a2fff5a2fff5a2fff5a2fff592fff592fff592fff592fff592f',
    'ff5930ff5830ff5830ff5830ff5830ff5830ff5730ff5730ff5730ff5730ff5731ff5731ff5631ff5631ff5631ff5631',
    'ff5631ff5631ff5531ff5531ff5531ff5532ff5532ff5432ff5432ff5432ff5432ff5432ff5432ff5332ff5332ff5332',
    'ff5333ff5333ff5333ff5233ff5233ff5233ff5233ff5233ff5233ff5133ff5134ff5134ff5134ff5134ff5034ff5034',
    'ff5034ff5034ff5034ff5034ff4f34ff4f35ff4f35ff4f35ff4f35ff4f35ff4e35ff4e35ff4e35ff4e35ff4e35ff4d35',
    'ff4d36ff4d36ff4d36ff4d36ff4d36ff4c36ff4c36ff4c36ff4c36ff4c36ff4c37ff4b37ff4b37ff4b37ff4b37ff4b37',
    'ff4a37ff4a37ff4a37ff4a37ff4a37ff4a38ff4938ff4938ff4938ff4938ff4938ff4938ff4838ff4838ff4838ff4838',
    'ff4839ff4739ff4739ff4739ff4739ff4739ff4739ff4639ff4639ff4639ff463aff463aff463aff453aff453aff453a',
  ].join(''),
  'Green to Red': [
    '30d15831d15832d15732d05733d05734d05635d05636d05636cf5637cf5538cf5539cf553acf543bce543bce543cce53',
    '3dce533ece533fcd533fcd5240cd5241cd5242cd5143cc5143cc5144cc5045cc5046cc5047cc4f47cb4f48cb4f49cb4f',
    '4acb4e4bcb4e4cca4e4cca4d4dca4d4eca4d4fca4c50c94c50c94c51c94b52c94b53c94b54c84b54c84a55c84a56c84a',
    '57c84958c74959c74959c7485ac7485bc7485cc6485dc6475dc6475ec6475fc64660c54661c54661c54562c54563c545',
    '64c44465c44465c44466c44467c44368c34369c3436ac3426ac3426bc3426cc3416dc2416ec2416ec2406fc24070c240',
    '71c14072c13f72c13f73c13f74c13e75c03e76c03e76c03d77c03d78c03d79bf3d7abf3c7bbf3c7bbf3c7cbf3b7dbe3b',
    '7ebe3b7fbe3a7fbe3a80be3a81bd3982bd3983bd3983bd3984bd3885bc3886bc3887bc3787bc3788bc3789bb368abb36',
    '8bbb368cbb368cbb358dba358eba358fba3490ba3490ba3491ba3392b93393b93394b93294b93295b93296b83297b831',
    '98b83199b83199b8309ab7309bb7309cb72f9db72f9db72f9eb62e9fb62ea0b62ea1b62ea1b62da2b52da3b52da4b52c',
    'a5b52ca5b52ca6b42ba7b42ba8b42ba9b42baab42aaab32aabb32aacb329adb329aeb329aeb228afb228b0b228b1b227',
    'b2b227b2b127b3b127b4b126b5b126b6b126b6b125b7b025b8b025b9b024bab024bbb024bbaf23bcaf23bdaf23beaf23',
    'bfaf22bfae22c0ae22c1ae21c2ae21c3ae21c3ad20c4ad20c5ad20c6ad20c7ad1fc8ac1fc8ac1fc9ac1ecaac1ecbac1e',
    'ccab1dccab1dcdab1dceab1ccfab1cd0aa1cd0aa1cd1aa1bd2aa1bd3aa1bd4a91ad4a91ad5a91ad6a919d7a919d8a819',
    'd9a819d9a818daa818dba818dca817dda717dda717dea716dfa716e0a716e1a615e1a615e2a615e3a615e4a614e5a514',
    'e5a514e6a513e7a513e8a513e9a412eaa412eaa412eba411eca411eda311eea311eea310efa310f0a310f1a20ff2a20f',
    'f2a20ff3a20ef4a20ef5a10ef6a10ef6a10df7a10df8a10df9a00cfaa00cfba00cfba00bfca00bfd9f0bfe9f0aff9f0a',
    'ff9f0aff9e0aff9e0aff9e0bff9d0bff9d0bff9d0bff9c0bff9c0cff9c0cff9b0cff9b0cff9b0cff9a0dff9a0dff9a0d',
    'ff990dff990dff980dff980eff980eff970eff970eff970eff960fff960fff960fff950fff950fff9510ff9410ff9410',
    'ff9410ff9310ff9310ff9211ff9211ff9211ff9111ff9111ff9112ff9012ff9012ff9012ff8f12ff8f13ff8f13ff8e13',
    'ff8e13ff8e13ff8d13ff8d14ff8d14ff8c14ff8c14ff8b14ff8b15ff8b15ff8a15ff8a15ff8a15ff8916ff8916ff8916',
    'ff8816ff8816ff8816ff8717ff8717ff8717ff8617ff8617ff8518ff8518ff8518ff8418ff8418ff8419ff8319ff8319',
    'ff8319ff8219ff8219ff821aff811aff811aff811aff801aff801bff7f1bff7f1bff7f1bff7e1bff7e1cff7e1cff7d1c',
    'ff7d1cff7d1cff7c1dff7c1dff7c1dff7b1dff7b1dff7b1dff7a1eff7a1eff791eff791eff791eff781fff781fff781f',
    'ff771fff771fff7720ff7620ff7620ff7620ff7520ff7520ff7521ff7421ff7421ff7321ff7321ff7322ff7222ff7222',
    'ff7222ff7122ff7123ff7123ff7023ff7023ff7023ff6f23ff6f24ff6f24ff6e24ff6e24ff6e24ff6d25ff6d25ff6c25',
    'ff6c25ff6c25ff6b26ff6b26ff6b26ff6a26ff6a26ff6a26ff6927ff6927ff6927ff6827ff6827ff6828ff6728ff6728',
    'ff6628ff6628ff6629ff6529ff6529ff6529ff6429ff6429ff642aff632aff632aff632aff622aff622bff622bff612b',
    'ff612bff602bff602cff602cff5f2cff5f2cff5f2cff5e2cff5e2dff5e2dff5d2dff5d2dff5d2dff5c2eff5c2eff5c2e',
    'ff5b2eff5b2eff5a2fff5a2fff5a2fff592fff592fff592fff5830ff5830ff5830ff5730ff5730ff5731ff5631ff5631',
    'ff5631ff5531ff5532ff5432ff5432ff5432ff5332ff5332ff5333ff5233ff5233ff5233ff5133ff5134ff5134ff5034',
    'ff5034ff5034ff4f35ff4f35ff4f35ff4e35ff4e35ff4d35ff4d36ff4d36ff4c36ff4c36ff4c36ff4b37ff4b37ff4b37',
    'ff4a37ff4a37ff4a38ff4938ff4938ff4938ff4838ff4838ff4739ff4739ff4739ff4639ff4639ff463aff453aff453a',
  ].join(''),
};

/** The schemas, in the order the editor lists them */
export const COLOR_SCHEMAS = Object.keys(MAPS);

interface ColorMap {
  /** Where each colour is on the map, from 0 to 1 */
  at: number[];
  /** Its channels, each from 0 to 1 */
  channels: Array<[number, number, number]>;
}

const cache = new Map<string, ColorMap>();

function colorMap(schema: string, dark: boolean): ColorMap | undefined {
  const packed = (dark ? DARK_MAPS[schema] : undefined) ?? MAPS[schema];
  if (packed === undefined) return undefined;
  const key = `${dark && DARK_MAPS[schema] ? 'dark' : 'light'}:${schema}`;
  let map = cache.get(key);
  if (!map) {
    const count = packed.length / 6;
    map = { at: [], channels: [] };
    for (let i = 0; i < count; i += 1) {
      const channel = (offset: number) => parseInt(packed.slice(i * 6 + offset, i * 6 + offset + 2), 16) / 255;
      map.at.push(i / (count - 1));
      map.channels.push([channel(0), channel(2), channel(4)]);
    }
    cache.set(key, map);
  }
  return map;
}

const enforceBounds = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * The colour at a place from 0 to 1 on a schema's map, as `rgb(r,g,b)` (vislib's getHeatmapColors);
 * `dark` takes the dark form of the theme's maps. Throws, as the original does, for a place off
 * the map or a schema that does not exist.
 */
export function heatmapColor(value: number, schema: string, dark = false): string {
  if (typeof value !== 'number' || value < 0 || value > 1) {
    throw new Error('heatmap_color expects a number from 0 to 1 as first parameter');
  }
  const map = colorMap(schema, dark);
  if (!map) throw new Error('invalid colorSchemaName provided');
  let i = 1;
  while (map.at[i] < value) i += 1;
  const width = Math.abs(map.at[i - 1] - map.at[i]);
  const scaling = (value - map.at[i - 1]) / width;
  const [r0, g0, b0] = map.channels[i - 1];
  const [r1, g1, b1] = map.channels[i];
  const r = enforceBounds(r0 + scaling * (r1 - r0));
  const g = enforceBounds(g0 + scaling * (g1 - g0));
  const b = enforceBounds(b0 + scaling * (b1 - b0));
  return `rgb(${Math.round(255 * r)},${Math.round(255 * g)},${Math.round(255 * b)})`;
}
