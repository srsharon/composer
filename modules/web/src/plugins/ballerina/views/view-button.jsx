/**
 * Copyright (c) 2018, WSO2 Inc. (http://www.wso2.org) All Rights Reserved.
 *
 * WSO2 Inc. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import React from 'react';
import PropTypes from 'prop-types';

/**
 * utton to switch views
 */
class ViewButton extends React.Component {

    render() {
        return (
            <div
                className='view-split-view-btn btn-icon'
                onClick={this.props.onClick}
            >
                <div className='bottom-label-icon-wrapper'>
                    <i className={`fw fw-${this.props.icon} fw-inverse`} />
                </div>
                <div
                    className='bottom-view-label'
                    onClick={this.props.onClick}
                >
                    {this.props.label}
                </div>
            </div>
        );
    }

}

ViewButton.propTypes = {
    onClick: PropTypes.func.isRequired,
    label: PropTypes.string,
    icon: PropTypes.string.isRequired,
};

ViewButton.defaultProps = {
    label: '',
};

export default ViewButton;